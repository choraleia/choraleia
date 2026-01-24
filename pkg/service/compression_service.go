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

// Compress performs conversation compression
func (s *CompressionService) Compress(ctx context.Context, conversationID string, modelID string) (*db.ConversationSnapshot, error) {
	// Get conversation
	var conv db.Conversation
	if err := s.db.First(&conv, "id = ?", conversationID).Error; err != nil {
		return nil, fmt.Errorf("conversation not found: %w", err)
	}

	// If no model specified, try to get from workspace configuration
	if modelID == "" && conv.WorkspaceID != "" {
		var workspace models.Workspace
		if err := s.db.First(&workspace, "id = ?", conv.WorkspaceID).Error; err == nil {
			if workspace.CompressionModel != nil && *workspace.CompressionModel != "" {
				modelID = *workspace.CompressionModel
				s.logger.Info("Using workspace compression model", "workspaceID", conv.WorkspaceID, "modelID", modelID)
			}
		}
	}

	// Get all non-system messages (system messages should not be compressed)
	var messages []db.Message
	if err := s.db.Where("conversation_id = ? AND is_compressed = ? AND role != ?", conversationID, false, "system").
		Order("created_at ASC").Find(&messages).Error; err != nil {
		return nil, err
	}

	// Calculate how many messages we can keep while staying under target
	totalTokens := s.estimateTokens(messages)
	recentMessagesKeep := s.config.RecentMessagesKeep

	// If total tokens exceed target, reduce the number of recent messages to keep
	// to ensure we compress enough
	if totalTokens > s.config.TargetTokens && len(messages) > recentMessagesKeep {
		// Be more aggressive - keep fewer messages
		// Calculate how many messages we need to compress to get under target
		for recentMessagesKeep > 3 && len(messages) > recentMessagesKeep {
			keepTokens := s.estimateTokens(messages[len(messages)-recentMessagesKeep:])
			if keepTokens < s.config.TargetTokens/2 { // Leave room for summary
				break
			}
			recentMessagesKeep = recentMessagesKeep / 2
			if recentMessagesKeep < 3 {
				recentMessagesKeep = 3
			}
		}
		s.logger.Info("Adjusting recent messages to keep",
			"original", s.config.RecentMessagesKeep,
			"adjusted", recentMessagesKeep,
			"totalTokens", totalTokens,
			"targetTokens", s.config.TargetTokens)
	}

	if len(messages) <= recentMessagesKeep {
		s.logger.Warn("Not enough messages to compress",
			"messageCount", len(messages),
			"recentMessagesKeep", recentMessagesKeep)
		return nil, nil // Not enough messages to compress
	}

	// Split: messages to compress vs messages to keep
	compressCount := len(messages) - recentMessagesKeep
	toCompress := messages[:compressCount]
	// toKeep := messages[compressCount:]

	// Generate summary using LLM
	extractedData, err := s.generateSummary(ctx, toCompress, modelID)
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
	// Get or create model first
	var chatModel model.ToolCallingChatModel
	var modelConfig *models.ModelConfig

	// Try to get model config by ID
	if modelID != "" {
		modelConfig, _ = s.modelService.GetModelConfig(modelID)
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
			modelConfig = modelsList[0]
			var err error
			chatModel, err = s.modelService.CreateChatModel(ctx, modelConfig)
			if err != nil {
				return nil, fmt.Errorf("failed to create chat model: %w", err)
			}
		} else {
			return nil, fmt.Errorf("no models available for compression")
		}
	}

	// Determine max chunk tokens based on model's context window
	// Use 75% of context window to leave room for prompt and response
	maxChunkTokens := 50000 // Default conservative limit
	if modelConfig != nil && modelConfig.Limits != nil && modelConfig.Limits.ContextWindow > 0 {
		// Use 75% of context window for input, leaving 25% for output
		maxChunkTokens = int(float64(modelConfig.Limits.ContextWindow) * 0.75)
		// Ensure a reasonable minimum
		if maxChunkTokens < 4000 {
			maxChunkTokens = 4000
		}
		s.logger.Debug("Using model context window for chunking",
			"model", modelConfig.Model,
			"contextWindow", modelConfig.Limits.ContextWindow,
			"maxChunkTokens", maxChunkTokens)
	}

	totalTokens := s.estimateTokens(messages)

	if totalTokens > maxChunkTokens {
		// Need to process in chunks
		s.logger.Info("Large conversation, processing in chunks",
			"totalTokens", totalTokens,
			"maxChunkTokens", maxChunkTokens,
			"messageCount", len(messages))
		return s.generateChunkedSummary(ctx, chatModel, messages, maxChunkTokens)
	}

	// Build conversation text for single-pass summarization
	var convText strings.Builder
	for _, msg := range messages {
		content := msg.GetTextContent()
		if content != "" {
			convText.WriteString(fmt.Sprintf("[%s]: %s\n\n", msg.Role, content))
		}
	}

	return s.generateSingleSummary(ctx, chatModel, convText.String())
}

// generateChunkedSummary processes large conversations in chunks
func (s *CompressionService) generateChunkedSummary(ctx context.Context, chatModel model.ToolCallingChatModel, messages []db.Message, maxChunkTokens int) (*db.CompressionExtractedData, error) {
	var chunkSummaries []string
	var allTopics, allDecisions, allFacts, allPreferences, allDetails []string

	// Split messages into chunks
	var currentChunk []db.Message
	currentTokens := 0

	for _, msg := range messages {
		msgTokens := s.estimateTokensFromString(msg.GetTextContent())

		if currentTokens+msgTokens > maxChunkTokens && len(currentChunk) > 0 {
			// Process current chunk
			summary, err := s.summarizeChunk(ctx, chatModel, currentChunk)
			if err != nil {
				s.logger.Warn("Failed to summarize chunk, using simple extraction", "error", err)
				// Fallback: just extract key content
				summary = s.extractKeyContent(currentChunk)
			}
			chunkSummaries = append(chunkSummaries, summary)

			// Reset chunk
			currentChunk = nil
			currentTokens = 0
		}

		currentChunk = append(currentChunk, msg)
		currentTokens += msgTokens
	}

	// Process remaining chunk
	if len(currentChunk) > 0 {
		summary, err := s.summarizeChunk(ctx, chatModel, currentChunk)
		if err != nil {
			s.logger.Warn("Failed to summarize final chunk, using simple extraction", "error", err)
			summary = s.extractKeyContent(currentChunk)
		}
		chunkSummaries = append(chunkSummaries, summary)
	}

	// Combine chunk summaries into final summary
	combinedSummary := strings.Join(chunkSummaries, "\n\n---\n\n")

	// If combined is still too long, do a final summarization pass
	if s.estimateTokensFromString(combinedSummary) > maxChunkTokens {
		finalData, err := s.generateSingleSummary(ctx, chatModel, combinedSummary)
		if err != nil {
			// Fallback: truncate
			s.logger.Warn("Failed to generate final summary, using truncated version", "error", err)
			if len(combinedSummary) > 10000 {
				combinedSummary = combinedSummary[:10000] + "...[truncated]"
			}
			return &db.CompressionExtractedData{
				Summary:   combinedSummary,
				KeyTopics: allTopics,
			}, nil
		}
		return finalData, nil
	}

	return &db.CompressionExtractedData{
		Summary:                combinedSummary,
		KeyTopics:              allTopics,
		KeyDecisions:           allDecisions,
		ExtractedFacts:         allFacts,
		UserPreferences:        allPreferences,
		ImportantDetails:       allDetails,
		ContextForContinuation: "Conversation was compressed from multiple segments.",
	}, nil
}

// summarizeChunk summarizes a single chunk of messages
func (s *CompressionService) summarizeChunk(ctx context.Context, chatModel model.ToolCallingChatModel, messages []db.Message) (string, error) {
	var convText strings.Builder
	for _, msg := range messages {
		content := msg.GetTextContent()
		if content != "" {
			// Truncate very long individual messages
			if len(content) > 5000 {
				content = content[:5000] + "...[truncated]"
			}
			convText.WriteString(fmt.Sprintf("[%s]: %s\n\n", msg.Role, content))
		}
	}

	prompt := `Summarize this conversation segment concisely. Focus on:
1. Main topics and tasks discussed
2. Key decisions made
3. Important information and context

Conversation:
` + convText.String() + `

Provide a concise summary (under 500 words):`

	resp, err := chatModel.Generate(ctx, []*schema.Message{
		schema.UserMessage(prompt),
	})
	if err != nil {
		return "", err
	}

	return resp.Content, nil
}

// extractKeyContent extracts key content without using LLM (fallback)
func (s *CompressionService) extractKeyContent(messages []db.Message) string {
	var result strings.Builder
	result.WriteString("Conversation segment summary:\n")

	for i, msg := range messages {
		content := msg.GetTextContent()
		if content == "" {
			continue
		}

		// Take first 200 chars of each message
		preview := content
		if len(preview) > 200 {
			preview = preview[:200] + "..."
		}

		result.WriteString(fmt.Sprintf("- [%s] %s\n", msg.Role, preview))

		// Limit to first 20 messages
		if i >= 20 {
			result.WriteString(fmt.Sprintf("... and %d more messages\n", len(messages)-20))
			break
		}
	}

	return result.String()
}

// generateSingleSummary generates summary from text in a single pass
func (s *CompressionService) generateSingleSummary(ctx context.Context, chatModel model.ToolCallingChatModel, convText string) (*db.CompressionExtractedData, error) {
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
` + convText + `

Output JSON only, no other text:`

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
	if err := s.db.Where("conversation_id = ?", conversationID).
		Order("created_at DESC").
		Find(&snapshots).Error; err != nil {
		return nil, err
	}
	return snapshots, nil
}

// GetSnapshotMessages returns the original messages for a snapshot
func (s *CompressionService) GetSnapshotMessages(ctx context.Context, snapshotID string) ([]db.Message, error) {
	// Get the snapshot to find message range
	var snapshot db.ConversationSnapshot
	if err := s.db.First(&snapshot, "id = ?", snapshotID).Error; err != nil {
		return nil, fmt.Errorf("snapshot not found: %w", err)
	}

	// Get messages that belong to this snapshot
	var messages []db.Message
	if err := s.db.Where("snapshot_id = ?", snapshotID).
		Order("created_at ASC").
		Find(&messages).Error; err != nil {
		return nil, err
	}

	return messages, nil
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

// estimateTokens estimates token count for messages (including tool calls and results)
func (s *CompressionService) estimateTokens(messages []db.Message) int {
	total := 0
	for _, msg := range messages {
		// Text content
		content := msg.GetTextContent()
		total += len(content) / 4

		// Reasoning content
		reasoning := msg.GetReasoningContent()
		total += len(reasoning) / 4

		// Tool calls
		for _, tc := range msg.GetToolCalls() {
			total += len(tc.Function.Name) / 4
			total += len(tc.Function.Arguments) / 4
			total += 20 // overhead for tool call structure
		}

		// Tool results (from Chunks)
		if msg.Chunks != nil {
			for _, chunk := range msg.Chunks {
				if chunk.Type == db.ChunkTypeToolResult {
					total += len(chunk.ToolResultContent) / 4
					total += 20 // overhead for tool result structure
				}
			}
		}

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
