// Compression service for conversation history management
package service

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"github.com/choraleia/choraleia/pkg/db"
	"github.com/choraleia/choraleia/pkg/models"
	"github.com/choraleia/choraleia/pkg/utils"
	"github.com/cloudwego/eino/components/model"
	"github.com/cloudwego/eino/schema"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

// CompressionConfig holds configuration for compression
type CompressionConfig struct {
	MaxContextTokens   int     `yaml:"max_context_tokens"`   // Max tokens before compression (e.g., 100000)
	TargetTokens       int     `yaml:"target_tokens"`        // Target tokens after compression (e.g., 60000)
	RecentMessagesKeep int     `yaml:"recent_messages_keep"` // Keep last N messages uncompressed (e.g., 20)
	CompressThreshold  float64 `yaml:"compress_threshold"`   // Trigger at this % of max (e.g., 0.8)
	ExtractToMemory    bool    `yaml:"extract_to_memory"`    // Extract facts to memory
	MaxRetries         int     `yaml:"max_retries"`          // Max retries on context length error
}

// DefaultCompressionConfig returns default compression configuration
func DefaultCompressionConfig() *CompressionConfig {
	return &CompressionConfig{
		MaxContextTokens:   100000,
		TargetTokens:       60000,
		RecentMessagesKeep: 20,
		CompressThreshold:  0.80,
		ExtractToMemory:    true,
		MaxRetries:         2,
	}
}

// CompressionService handles conversation compression
type CompressionService struct {
	db            *gorm.DB
	modelService  *ModelService
	memoryService *MemoryService
	config        *CompressionConfig
	logger        *slog.Logger
}

// NewCompressionService creates a new compression service
func NewCompressionService(database *gorm.DB, modelService *ModelService, memoryService *MemoryService, config *CompressionConfig) *CompressionService {
	if config == nil {
		config = DefaultCompressionConfig()
	}
	return &CompressionService{
		db:            database,
		modelService:  modelService,
		memoryService: memoryService,
		config:        config,
		logger:        utils.GetLogger(),
	}
}

// AutoMigrate creates database tables
func (s *CompressionService) AutoMigrate() error {
	return s.db.AutoMigrate(&db.ConversationSnapshot{}, &db.Conversation{})
}

// CheckAndCompress checks if compression is needed and performs it
func (s *CompressionService) CheckAndCompress(ctx context.Context, conversationID string) (*db.ConversationSnapshot, error) {
	// Get all messages for the conversation
	var messages []db.Message
	if err := s.db.Where("conversation_id = ?", conversationID).Order("created_at ASC").Find(&messages).Error; err != nil {
		return nil, err
	}

	// Estimate total tokens
	totalTokens := s.estimateTokens(messages)
	threshold := int(float64(s.config.MaxContextTokens) * s.config.CompressThreshold)

	if totalTokens < threshold {
		return nil, nil // No compression needed
	}

	s.logger.Info("Conversation needs compression",
		"conversationID", conversationID,
		"currentTokens", totalTokens,
		"threshold", threshold)

	return s.Compress(ctx, conversationID)
}

// Compress performs conversation compression
func (s *CompressionService) Compress(ctx context.Context, conversationID string) (*db.ConversationSnapshot, error) {
	// Get conversation
	var conv db.Conversation
	if err := s.db.First(&conv, "id = ?", conversationID).Error; err != nil {
		return nil, fmt.Errorf("conversation not found: %w", err)
	}

	// Get all messages
	var messages []db.Message
	if err := s.db.Where("conversation_id = ? AND is_compressed = ?", conversationID, false).
		Order("created_at ASC").Find(&messages).Error; err != nil {
		return nil, err
	}

	if len(messages) <= s.config.RecentMessagesKeep {
		return nil, nil // Not enough messages to compress
	}

	// Split: messages to compress vs messages to keep
	compressCount := len(messages) - s.config.RecentMessagesKeep
	toCompress := messages[:compressCount]
	// toKeep := messages[compressCount:]

	// Generate summary using LLM
	extractedData, err := s.generateSummary(ctx, toCompress, conv.ModelID)
	if err != nil {
		return nil, fmt.Errorf("failed to generate summary: %w", err)
	}

	// Calculate token stats
	originalTokens := s.estimateTokens(toCompress)
	compressedTokens := s.estimateTokensFromString(extractedData.Summary)
	var compressionRatio float64
	if originalTokens > 0 {
		compressionRatio = float64(compressedTokens) / float64(originalTokens)
	}

	// Create snapshot
	snapshot := &db.ConversationSnapshot{
		ID:               uuid.New().String(),
		ConversationID:   conversationID,
		WorkspaceID:      conv.WorkspaceID,
		Summary:          extractedData.Summary,
		KeyTopics:        extractedData.KeyTopics,
		KeyDecisions:     extractedData.KeyDecisions,
		FromMessageID:    toCompress[0].ID,
		ToMessageID:      toCompress[len(toCompress)-1].ID,
		MessageCount:     len(toCompress),
		OriginalTokens:   originalTokens,
		CompressedTokens: compressedTokens,
		CompressionRatio: compressionRatio,
		CreatedAt:        time.Now(),
	}

	// Save snapshot
	if err := s.db.Create(snapshot).Error; err != nil {
		return nil, fmt.Errorf("failed to create snapshot: %w", err)
	}

	// Extract to memory if enabled
	if s.config.ExtractToMemory && s.memoryService != nil {
		memoryIDs := s.extractToMemory(ctx, conv.WorkspaceID, snapshot.ID, extractedData)
		snapshot.MemoryIDs = memoryIDs
		s.db.Model(snapshot).Update("memory_ids", snapshot.MemoryIDs)
	}

	// Mark messages as compressed
	messageIDs := make([]string, len(toCompress))
	for i, m := range toCompress {
		messageIDs[i] = m.ID
	}
	s.db.Model(&db.Message{}).Where("id IN ?", messageIDs).Updates(map[string]interface{}{
		"is_compressed": true,
		"snapshot_id":   snapshot.ID,
	})

	// Update conversation metadata
	now := time.Now()
	fullSummary := extractedData.Summary
	if extractedData.ContextForContinuation != "" {
		fullSummary += "\n\nContext for continuation: " + extractedData.ContextForContinuation
	}

	s.db.Model(&conv).Updates(map[string]interface{}{
		"compressed_at":     &now,
		"compression_count": gorm.Expr("compression_count + 1"),
		"summary":           fullSummary,
		"key_topics":        db.StringArray(extractedData.KeyTopics),
		"key_decisions":     db.StringArray(extractedData.KeyDecisions),
	})

	s.logger.Info("Conversation compressed successfully",
		"conversationID", conversationID,
		"compressedMessages", len(toCompress),
		"originalTokens", originalTokens,
		"compressedTokens", compressedTokens,
		"ratio", fmt.Sprintf("%.2f", compressionRatio))

	return snapshot, nil
}

// generateSummary uses LLM to generate structured summary
func (s *CompressionService) generateSummary(ctx context.Context, messages []db.Message, modelID string) (*db.CompressionExtractedData, error) {
	// Build conversation text
	var convText strings.Builder
	for _, msg := range messages {
		content := msg.GetTextContent()
		if content != "" {
			convText.WriteString(fmt.Sprintf("[%s]: %s\n\n", msg.Role, content))
		}
	}

	prompt := `Analyze the following conversation history and generate a structured summary.

Output a JSON object with these fields:
{
  "summary": "Comprehensive summary of the conversation including main topics discussed, progress made, and current state",
  "key_topics": ["topic1", "topic2", ...],
  "key_decisions": ["decision1: reason", "decision2: reason", ...],
  "extracted_facts": ["fact1", "fact2", ...],
  "user_preferences": ["preference1", "preference2", ...],
  "important_details": ["detail1", "detail2", ...],
  "context_for_continuation": "Brief context that would help continue this conversation"
}

Requirements:
1. Summary should be detailed enough to understand the conversation context
2. Extract all factual information that might be useful later
3. Capture any user preferences or instructions explicitly stated
4. Important details include code snippets mentioned, file paths, configuration values, etc.
5. Be objective and concise

Conversation History:
` + convText.String() + `

Output JSON only, no other text:`

	// Get or create model
	var chatModel model.ToolCallingChatModel

	// Try to get model config by ID
	if modelID != "" {
		modelConfig, _ := s.modelService.GetModelConfig(modelID)
		if modelConfig != nil {
			var err error
			chatModel, err = s.modelService.CreateChatModel(ctx, modelConfig)
			if err != nil {
				s.logger.Warn("Failed to create model from ID, will try default", "modelID", modelID, "error", err)
			}
		}
	}

	// Fallback to first available model
	if chatModel == nil {
		modelsList, _ := models.LoadModels()
		if len(modelsList) > 0 {
			var err error
			chatModel, err = s.modelService.CreateChatModel(ctx, modelsList[0])
			if err != nil {
				return nil, fmt.Errorf("failed to create chat model: %w", err)
			}
		} else {
			return nil, fmt.Errorf("no models available for compression")
		}
	}

	// Generate summary
	resp, err := chatModel.Generate(ctx, []*schema.Message{
		schema.UserMessage(prompt),
	})
	if err != nil {
		return nil, fmt.Errorf("LLM generation failed: %w", err)
	}

	// Parse response
	content := resp.Content
	// Try to extract JSON from response
	content = strings.TrimSpace(content)
	if idx := strings.Index(content, "{"); idx >= 0 {
		content = content[idx:]
	}
	if idx := strings.LastIndex(content, "}"); idx >= 0 {
		content = content[:idx+1]
	}

	var result db.CompressionExtractedData
	if err := json.Unmarshal([]byte(content), &result); err != nil {
		// If parsing fails, use raw content as summary
		s.logger.Warn("Failed to parse compression JSON, using raw content", "error", err)
		result.Summary = resp.Content
	}

	return &result, nil
}

// extractToMemory stores extracted data as memories
func (s *CompressionService) extractToMemory(ctx context.Context, workspaceID, snapshotID string, data *db.CompressionExtractedData) []string {
	var memoryIDs []string

	// Store summary
	if data.Summary != "" {
		mem, err := s.memoryService.Store(ctx, workspaceID, &db.CreateMemoryRequest{
			Type:       db.MemoryTypeSummary,
			Key:        fmt.Sprintf("compression_summary_%s", snapshotID),
			Content:    data.Summary,
			Category:   "conversation",
			SourceType: db.MemorySourceCompression,
			SourceID:   &snapshotID,
			Importance: 70,
		})
		if err == nil {
			memoryIDs = append(memoryIDs, mem.ID)
		}
	}

	// Store facts
	for i, fact := range data.ExtractedFacts {
		mem, err := s.memoryService.Store(ctx, workspaceID, &db.CreateMemoryRequest{
			Type:       db.MemoryTypeFact,
			Key:        fmt.Sprintf("fact_%s_%d", snapshotID[:8], i),
			Content:    fact,
			Category:   "extracted",
			SourceType: db.MemorySourceCompression,
			SourceID:   &snapshotID,
			Importance: 60,
		})
		if err == nil {
			memoryIDs = append(memoryIDs, mem.ID)
		}
	}

	// Store preferences
	for i, pref := range data.UserPreferences {
		mem, err := s.memoryService.Store(ctx, workspaceID, &db.CreateMemoryRequest{
			Type:       db.MemoryTypePreference,
			Key:        fmt.Sprintf("pref_%s_%d", snapshotID[:8], i),
			Content:    pref,
			Category:   "user",
			SourceType: db.MemorySourceCompression,
			SourceID:   &snapshotID,
			Importance: 75,
		})
		if err == nil {
			memoryIDs = append(memoryIDs, mem.ID)
		}
	}

	// Store important details
	for i, detail := range data.ImportantDetails {
		mem, err := s.memoryService.Store(ctx, workspaceID, &db.CreateMemoryRequest{
			Type:       db.MemoryTypeDetail,
			Key:        fmt.Sprintf("detail_%s_%d", snapshotID[:8], i),
			Content:    detail,
			Category:   "technical",
			SourceType: db.MemorySourceCompression,
			SourceID:   &snapshotID,
			Importance: 65,
		})
		if err == nil {
			memoryIDs = append(memoryIDs, mem.ID)
		}
	}

	return memoryIDs
}

// GetSnapshots returns all snapshots for a conversation
func (s *CompressionService) GetSnapshots(ctx context.Context, conversationID string) ([]db.ConversationSnapshot, error) {
	var snapshots []db.ConversationSnapshot
	err := s.db.Where("conversation_id = ?", conversationID).
		Order("created_at DESC").
		Find(&snapshots).Error
	return snapshots, err
}

// BuildSummaryContext builds the summary context string for LLM prompt
func (s *CompressionService) BuildSummaryContext(ctx context.Context, conversationID string) string {
	var conv db.Conversation
	if err := s.db.First(&conv, "id = ?", conversationID).Error; err != nil {
		return ""
	}

	if conv.Summary == "" {
		return ""
	}

	var sb strings.Builder
	sb.WriteString("=== CONVERSATION HISTORY SUMMARY ===\n")
	sb.WriteString("The following is a summary of earlier conversation that has been compressed.\n\n")
	sb.WriteString(conv.Summary)

	if len(conv.KeyTopics) > 0 {
		sb.WriteString("\n\nKey Topics: ")
		sb.WriteString(strings.Join(conv.KeyTopics, ", "))
	}

	if len(conv.KeyDecisions) > 0 {
		sb.WriteString("\n\nKey Decisions:\n")
		for _, d := range conv.KeyDecisions {
			sb.WriteString("- " + d + "\n")
		}
	}

	sb.WriteString("\n=== END OF SUMMARY ===\n")
	sb.WriteString("The following are recent messages:\n")

	return sb.String()
}

// estimateTokens estimates token count for messages
func (s *CompressionService) estimateTokens(messages []db.Message) int {
	total := 0
	for _, msg := range messages {
		content := msg.GetTextContent()
		// Rough estimate: 1 token ≈ 4 characters
		total += len(content) / 4
		// Add overhead for role, metadata
		total += 10
	}
	return total
}

// estimateTokensFromString estimates tokens from a string
func (s *CompressionService) estimateTokensFromString(text string) int {
	return len(text) / 4
}

// IsContextLengthError checks if error is context length exceeded
func IsContextLengthError(err error) bool {
	if err == nil {
		return false
	}
	errStr := strings.ToLower(err.Error())
	return strings.Contains(errStr, "context_length_exceeded") ||
		strings.Contains(errStr, "maximum context length") ||
		strings.Contains(errStr, "token limit") ||
		strings.Contains(errStr, "too many tokens") ||
		strings.Contains(errStr, "context length") ||
		strings.Contains(errStr, "max_tokens")
}
