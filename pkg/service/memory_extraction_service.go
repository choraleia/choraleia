// Memory extraction service for intelligent memory management
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
	einoModel "github.com/cloudwego/eino/components/model"
	"github.com/cloudwego/eino/schema"
	"gorm.io/gorm"
)

// MemoryExtractionConfig holds configuration for memory extraction
type MemoryExtractionConfig struct {
	Enabled              bool `yaml:"enabled"`                // Enable auto memory extraction
	ExtractAfterMessages int  `yaml:"extract_after_messages"` // Extract after N messages (e.g., 5)
	MinMessageLength     int  `yaml:"min_message_length"`     // Minimum message length to trigger extraction
	MaxMemoriesPerRound  int  `yaml:"max_memories_per_round"` // Max memories to extract per round
}

// DefaultMemoryExtractionConfig returns default configuration
func DefaultMemoryExtractionConfig() *MemoryExtractionConfig {
	return &MemoryExtractionConfig{
		Enabled:              true,
		ExtractAfterMessages: 5,
		MinMessageLength:     100,
		MaxMemoriesPerRound:  5,
	}
}

// MemoryExtractionService handles intelligent memory extraction from conversations
type MemoryExtractionService struct {
	db            *gorm.DB
	modelService  *ModelService
	memoryService *MemoryService
	config        *MemoryExtractionConfig
	logger        *slog.Logger
}

// NewMemoryExtractionService creates a new memory extraction service
func NewMemoryExtractionService(database *gorm.DB, modelService *ModelService, memoryService *MemoryService, config *MemoryExtractionConfig) *MemoryExtractionService {
	if config == nil {
		config = DefaultMemoryExtractionConfig()
	}
	return &MemoryExtractionService{
		db:            database,
		modelService:  modelService,
		memoryService: memoryService,
		config:        config,
		logger:        utils.GetLogger(),
	}
}

// ExtractedMemoryItem represents a single extracted memory
type ExtractedMemoryItem struct {
	Type       string `json:"type"`       // fact, preference, instruction, learned
	Key        string `json:"key"`        // Unique key for the memory
	Content    string `json:"content"`    // Memory content
	Category   string `json:"category"`   // Category for organization
	Importance int    `json:"importance"` // 0-100
	Reason     string `json:"reason"`     // Why this should be remembered
}

// ExtractionResult represents the result of memory extraction
type ExtractionResult struct {
	Memories       []ExtractedMemoryItem `json:"memories"`
	ConversationID string                `json:"conversation_id"`
	ExtractedAt    time.Time             `json:"extracted_at"`
	MessageRange   string                `json:"message_range"` // "from_id:to_id"
}

// ExtractFromRecentMessages analyzes recent messages and extracts memories
func (s *MemoryExtractionService) ExtractFromRecentMessages(ctx context.Context, workspaceID, conversationID string, recentMessages []db.Message) (*ExtractionResult, error) {
	if !s.config.Enabled || s.memoryService == nil {
		return nil, nil
	}

	// Check if we have enough messages
	if len(recentMessages) < s.config.ExtractAfterMessages {
		return nil, nil
	}

	// Build conversation text for analysis
	var convText strings.Builder
	var totalLength int
	for _, msg := range recentMessages {
		content := msg.GetTextContent()
		totalLength += len(content)
		convText.WriteString(fmt.Sprintf("[%s]: %s\n\n", msg.Role, content))
	}

	// Check minimum length
	if totalLength < s.config.MinMessageLength {
		return nil, nil
	}

	// Get workspace to check if memory is enabled
	var workspace models.Workspace
	if err := s.db.First(&workspace, "id = ?", workspaceID).Error; err != nil {
		return nil, err
	}

	if !workspace.MemoryEnabled {
		return nil, nil
	}

	// Get conversation for model ID
	var conv db.Conversation
	if err := s.db.First(&conv, "id = ?", conversationID).Error; err != nil {
		return nil, err
	}

	// Extract memories using LLM
	extracted, err := s.extractMemoriesWithLLM(ctx, convText.String(), conv.ModelID)
	if err != nil {
		s.logger.Warn("Memory extraction failed", "error", err)
		return nil, err
	}

	// Store extracted memories
	result := &ExtractionResult{
		Memories:       extracted,
		ConversationID: conversationID,
		ExtractedAt:    time.Now(),
	}

	if len(recentMessages) > 0 {
		result.MessageRange = fmt.Sprintf("%s:%s", recentMessages[0].ID, recentMessages[len(recentMessages)-1].ID)
	}

	// Store each extracted memory
	for _, mem := range extracted {
		_, err := s.memoryService.Store(ctx, workspaceID, &db.CreateMemoryRequest{
			Type:       db.MemoryType(mem.Type),
			Key:        mem.Key,
			Content:    mem.Content,
			Category:   mem.Category,
			Importance: mem.Importance,
			SourceType: db.MemorySourceConversation,
			SourceID:   &conversationID,
		})
		if err != nil {
			s.logger.Warn("Failed to store extracted memory",
				"key", mem.Key,
				"error", err)
		}
	}

	s.logger.Info("Memory extraction completed",
		"conversationID", conversationID,
		"extractedCount", len(extracted))

	return result, nil
}

// extractMemoriesWithLLM uses LLM to identify important information to remember
func (s *MemoryExtractionService) extractMemoriesWithLLM(ctx context.Context, conversationText, modelID string) ([]ExtractedMemoryItem, error) {
	prompt := fmt.Sprintf(`Analyze the following conversation and extract important information that should be remembered for future conversations.

Focus on:
1. User preferences (coding style, language preferences, tools they use)
2. Technical facts (project structure, tech stack, configurations)
3. Instructions or rules the user has specified
4. Important decisions made during the conversation
5. Key learnings or patterns

For each piece of information, provide:
- type: one of "fact", "preference", "instruction", "learned"
- key: a unique identifier (snake_case, descriptive)
- content: the information to remember (concise but complete)
- category: category for organization (e.g., "coding", "project", "user", "config")
- importance: 0-100 (higher = more important to remember)
- reason: why this should be remembered

Output a JSON array of objects. Only include genuinely important information worth remembering. If nothing significant, return empty array [].

Maximum %d items.

Conversation:
%s

Output JSON array only:`, s.config.MaxMemoriesPerRound, conversationText)

	// Get chat model
	chatModel, err := s.getChatModel(ctx, modelID)
	if err != nil {
		return nil, err
	}

	// Generate
	resp, err := chatModel.Generate(ctx, []*schema.Message{
		schema.UserMessage(prompt),
	})
	if err != nil {
		return nil, fmt.Errorf("LLM generation failed: %w", err)
	}

	// Parse response
	content := strings.TrimSpace(resp.Content)
	if idx := strings.Index(content, "["); idx >= 0 {
		content = content[idx:]
	}
	if idx := strings.LastIndex(content, "]"); idx >= 0 {
		content = content[:idx+1]
	}

	var memories []ExtractedMemoryItem
	if err := json.Unmarshal([]byte(content), &memories); err != nil {
		s.logger.Warn("Failed to parse extracted memories JSON", "error", err, "content", content)
		return nil, nil // Return empty instead of error
	}

	// Validate and limit
	var validMemories []ExtractedMemoryItem
	for _, mem := range memories {
		if mem.Type == "" || mem.Key == "" || mem.Content == "" {
			continue
		}
		// Validate type
		switch mem.Type {
		case "fact", "preference", "instruction", "learned":
			// Valid
		default:
			mem.Type = "fact" // Default to fact
		}
		// Ensure importance is in range
		if mem.Importance < 0 {
			mem.Importance = 50
		} else if mem.Importance > 100 {
			mem.Importance = 100
		}
		validMemories = append(validMemories, mem)
		if len(validMemories) >= s.config.MaxMemoriesPerRound {
			break
		}
	}

	return validMemories, nil
}

// getChatModel gets a chat model for extraction
func (s *MemoryExtractionService) getChatModel(ctx context.Context, modelID string) (einoModel.ToolCallingChatModel, error) {
	if modelID != "" {
		modelConfig, err := s.modelService.GetModelConfig(modelID)
		if err == nil && modelConfig != nil {
			return s.modelService.CreateChatModel(ctx, modelConfig)
		}
	}

	// Fallback to first available model
	modelsList, err := models.LoadModels()
	if err != nil || len(modelsList) == 0 {
		return nil, fmt.Errorf("no models available")
	}

	return s.modelService.CreateChatModel(ctx, modelsList[0])
}

// ExtractTopicsFromConversation extracts key topics from a conversation
func (s *MemoryExtractionService) ExtractTopicsFromConversation(ctx context.Context, conversationID string) ([]string, error) {
	// Get all messages
	var messages []db.Message
	if err := s.db.Where("conversation_id = ?", conversationID).
		Order("created_at ASC").Find(&messages).Error; err != nil {
		return nil, err
	}

	if len(messages) < 3 {
		return nil, nil // Not enough messages
	}

	// Get conversation for model ID
	var conv db.Conversation
	if err := s.db.First(&conv, "id = ?", conversationID).Error; err != nil {
		return nil, err
	}

	// Build conversation text
	var convText strings.Builder
	for _, msg := range messages {
		content := msg.GetTextContent()
		if content != "" {
			convText.WriteString(fmt.Sprintf("[%s]: %s\n\n", msg.Role, content))
		}
	}

	prompt := `Analyze the following conversation and extract the main topics discussed.

Output a JSON array of topic strings. Each topic should be:
- Concise (2-5 words)
- Specific enough to be meaningful
- Relevant to the main discussion

Maximum 10 topics. Order by importance.

Conversation:
` + convText.String() + `

Output JSON array only (e.g., ["topic1", "topic2"]):
`

	chatModel, err := s.getChatModel(ctx, conv.ModelID)
	if err != nil {
		return nil, err
	}

	resp, err := chatModel.Generate(ctx, []*schema.Message{
		schema.UserMessage(prompt),
	})
	if err != nil {
		return nil, err
	}

	// Parse response
	content := strings.TrimSpace(resp.Content)
	if idx := strings.Index(content, "["); idx >= 0 {
		content = content[idx:]
	}
	if idx := strings.LastIndex(content, "]"); idx >= 0 {
		content = content[:idx+1]
	}

	var topics []string
	if err := json.Unmarshal([]byte(content), &topics); err != nil {
		return nil, nil
	}

	// Update conversation with topics
	if len(topics) > 0 {
		s.db.Model(&conv).Update("key_topics", db.StringArray(topics))
	}

	return topics, nil
}

// AnalyzeAndUpdateConversation performs full analysis on a conversation
// This includes topic extraction, memory extraction, and updating conversation metadata
func (s *MemoryExtractionService) AnalyzeAndUpdateConversation(ctx context.Context, workspaceID, conversationID string) error {
	// Get recent messages
	var messages []db.Message
	if err := s.db.Where("conversation_id = ?", conversationID).
		Order("created_at DESC").
		Limit(s.config.ExtractAfterMessages * 2).
		Find(&messages).Error; err != nil {
		return err
	}

	// Reverse to get chronological order
	for i, j := 0, len(messages)-1; i < j; i, j = i+1, j-1 {
		messages[i], messages[j] = messages[j], messages[i]
	}

	// Extract memories from recent messages
	if _, err := s.ExtractFromRecentMessages(ctx, workspaceID, conversationID, messages); err != nil {
		s.logger.Warn("Memory extraction failed during analysis", "error", err)
	}

	// Extract topics
	if _, err := s.ExtractTopicsFromConversation(ctx, conversationID); err != nil {
		s.logger.Warn("Topic extraction failed during analysis", "error", err)
	}

	return nil
}
