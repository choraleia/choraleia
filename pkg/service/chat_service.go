// Workspace Chat Service - handles chat conversations with OpenAI-compatible API
package service

import (
	"context"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"strings"
	"sync"
	"time"

	"github.com/choraleia/choraleia/pkg/db"
	"github.com/choraleia/choraleia/pkg/models"
	"github.com/choraleia/choraleia/pkg/utils"
	"github.com/cloudwego/eino/adk"
	"github.com/cloudwego/eino/components/model"
	"github.com/cloudwego/eino/components/tool"
	"github.com/cloudwego/eino/compose"
	"github.com/cloudwego/eino/schema"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

var (
	ErrConversationNotFound = errors.New("conversation not found")
	ErrMessageNotFound      = errors.New("message not found")
	ErrStreamCancelled      = errors.New("stream cancelled")
	ErrNoMessages           = errors.New("no messages provided")
	ErrModelNotConfigured   = errors.New("model not configured")
)

// ToolLoader interface for loading tools (implemented by tools package)
type ToolLoader interface {
	LoadWorkspaceTools(ctx context.Context, workspaceID string, toolConfigs []models.WorkspaceTool) ([]tool.InvokableTool, error)
}

// ChatService handles workspace chat operations
type ChatService struct {
	db               *gorm.DB
	modelService     *ModelService
	workspaceService *WorkspaceService
	toolLoader       ToolLoader
	logger           *slog.Logger

	// Active streams management for graceful handling
	activeStreams sync.Map // conversationID -> *StreamSession
}

// StreamSession tracks an active streaming session
type StreamSession struct {
	ConversationID string
	MessageID      string // Current assistant message being streamed
	Cancel         context.CancelFunc
	Events         chan *StreamEvent
	LastEventID    int64
	StartedAt      time.Time
	mu             sync.Mutex
}

// StreamEvent represents a streaming event
type StreamEvent struct {
	ID    int64       `json:"id"`
	Type  string      `json:"type"`
	Data  interface{} `json:"data"`
	Error string      `json:"error,omitempty"`
}

// NewChatService creates a new chat service
func NewChatService(db *gorm.DB, modelService *ModelService, workspaceService *WorkspaceService) *ChatService {
	return &ChatService{
		db:               db,
		modelService:     modelService,
		workspaceService: workspaceService,
		logger:           utils.GetLogger(),
	}
}

// SetToolLoader sets the tool loader (to avoid import cycle)
func (s *ChatService) SetToolLoader(loader ToolLoader) {
	s.toolLoader = loader
}

// AutoMigrate creates database tables
func (s *ChatService) AutoMigrate() error {
	return s.db.AutoMigrate(&models.Conversation{}, &models.Message{})
}

// ========== Conversation Management ==========

// CreateConversation creates a new conversation
func (s *ChatService) CreateConversation(req *models.CreateConversationRequest) (*models.Conversation, error) {
	title := req.Title
	if title == "" {
		title = "New Chat"
	}

	conv := &models.Conversation{
		ID:          uuid.New().String(),
		WorkspaceID: req.WorkspaceID,
		RoomID:      req.RoomID,
		Title:       title,
		ModelID:     req.ModelID,
		Status:      models.ConversationStatusActive,
	}

	if err := s.db.Create(conv).Error; err != nil {
		return nil, fmt.Errorf("failed to create conversation: %w", err)
	}

	return conv, nil
}

// GetConversation retrieves a conversation by ID
func (s *ChatService) GetConversation(id string) (*models.Conversation, error) {
	var conv models.Conversation
	if err := s.db.First(&conv, "id = ?", id).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrConversationNotFound
		}
		return nil, err
	}
	return &conv, nil
}

// ListConversations lists conversations for a workspace
func (s *ChatService) ListConversations(workspaceID string, status string, limit, offset int) ([]models.Conversation, bool, error) {
	var conversations []models.Conversation

	query := s.db.Where("workspace_id = ?", workspaceID)
	if status != "" {
		query = query.Where("status = ?", status)
	}

	// Fetch one more to check if there are more results
	if err := query.Order("updated_at DESC").Limit(limit + 1).Offset(offset).Find(&conversations).Error; err != nil {
		return nil, false, err
	}

	hasMore := len(conversations) > limit
	if hasMore {
		conversations = conversations[:limit]
	}

	return conversations, hasMore, nil
}

// UpdateConversation updates a conversation
func (s *ChatService) UpdateConversation(id string, req *models.UpdateConversationRequest) (*models.Conversation, error) {
	conv, err := s.GetConversation(id)
	if err != nil {
		return nil, err
	}

	updates := map[string]interface{}{}
	if req.Title != "" {
		updates["title"] = req.Title
	}
	if req.Status != "" {
		updates["status"] = req.Status
	}

	if len(updates) > 0 {
		updates["updated_at"] = time.Now()
		if err := s.db.Model(conv).Updates(updates).Error; err != nil {
			return nil, err
		}
	}

	return s.GetConversation(id)
}

// DeleteConversation deletes a conversation and its messages
func (s *ChatService) DeleteConversation(id string) error {
	return s.db.Transaction(func(tx *gorm.DB) error {
		// Delete messages first
		if err := tx.Where("conversation_id = ?", id).Delete(&models.Message{}).Error; err != nil {
			return err
		}
		// Delete conversation
		if err := tx.Delete(&models.Conversation{}, "id = ?", id).Error; err != nil {
			return err
		}
		return nil
	})
}

// ========== Message Management ==========

// GetMessages retrieves all messages for a conversation
func (s *ChatService) GetMessages(conversationID string) ([]models.Message, error) {
	var messages []models.Message

	if err := s.db.Where("conversation_id = ?", conversationID).
		Order("created_at ASC").
		Find(&messages).Error; err != nil {
		return nil, err
	}

	return messages, nil
}

// GetMessage retrieves a single message
func (s *ChatService) GetMessage(id string) (*models.Message, error) {
	var msg models.Message
	if err := s.db.First(&msg, "id = ?", id).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrMessageNotFound
		}
		return nil, err
	}
	return &msg, nil
}

// SaveMessage saves a message to the database
func (s *ChatService) SaveMessage(msg *models.Message) error {
	if msg.ID == "" {
		msg.ID = uuid.New().String()
	}
	return s.db.Save(msg).Error
}

// UpdateMessageStatus updates the status of a message
func (s *ChatService) UpdateMessageStatus(id, status, finishReason string) error {
	updates := map[string]interface{}{
		"status":     status,
		"updated_at": time.Now(),
	}
	if finishReason != "" {
		updates["finish_reason"] = finishReason
	}
	return s.db.Model(&models.Message{}).Where("id = ?", id).Updates(updates).Error
}

// AppendMessageContent appends content to an existing message (for streaming)
func (s *ChatService) AppendMessageContent(id, content string) error {
	return s.db.Model(&models.Message{}).
		Where("id = ?", id).
		Update("content", gorm.Expr("COALESCE(content, '') || ?", content)).
		Update("updated_at", time.Now()).
		Error
}

// ========== Branch Support ==========

// CreateBranch creates a new branch from a parent message
func (s *ChatService) CreateBranch(conversationID string, parentID *string, newMessage *models.Message) error {
	return s.db.Transaction(func(tx *gorm.DB) error {
		// Find the highest branch index among siblings
		var maxIndex int
		query := tx.Model(&models.Message{}).Where("conversation_id = ?", conversationID)
		if parentID == nil {
			query = query.Where("parent_id IS NULL")
		} else {
			query = query.Where("parent_id = ?", *parentID)
		}
		query.Select("COALESCE(MAX(branch_index), -1)").Scan(&maxIndex)

		// Set up the new message
		newMessage.ParentID = parentID
		newMessage.BranchIndex = maxIndex + 1
		newMessage.ConversationID = conversationID

		return tx.Create(newMessage).Error
	})
}

// ========== Chat Completion ==========

// Chat handles a chat completion request (non-streaming)
func (s *ChatService) Chat(ctx context.Context, req *models.ChatCompletionRequest) (*models.ChatCompletionResponse, error) {
	if len(req.Messages) == 0 {
		return nil, ErrNoMessages
	}

	// Get or create conversation
	conv, err := s.getOrCreateConversation(req)
	if err != nil {
		return nil, err
	}

	// Save user message
	userMsg := req.Messages[len(req.Messages)-1]
	if userMsg.Role == models.RoleUser {
		if err := s.saveUserMessage(conv.ID, &userMsg); err != nil {
			return nil, err
		}
	}

	// Load workspace tools
	workspaceTools, err := s.loadWorkspaceTools(ctx, req.WorkspaceID)
	if err != nil {
		s.logger.Warn("Failed to load workspace tools", "error", err)
	}

	// Build conversation history
	history, err := s.buildConversationHistory(conv.ID)
	if err != nil {
		return nil, err
	}

	// Get model
	modelID := req.Model
	if modelID == "" {
		modelID = conv.ModelID
	}

	// Create assistant message placeholder
	assistantMsg := &models.Message{
		ID:             uuid.New().String(),
		ConversationID: conv.ID,
		Role:           models.RoleAssistant,
		Status:         models.MessageStatusPending,
	}
	if err := s.SaveMessage(assistantMsg); err != nil {
		return nil, err
	}

	// Run agent
	response, err := s.runAgent(ctx, modelID, history, workspaceTools, assistantMsg)
	if err != nil {
		// Update message as error
		s.UpdateMessageStatus(assistantMsg.ID, models.MessageStatusError, models.FinishReasonError)
		return nil, err
	}

	// Update conversation timestamp
	s.db.Model(&models.Conversation{}).Where("id = ?", conv.ID).Update("updated_at", time.Now())

	response.ConversationID = conv.ID
	return response, nil
}

// ChatStream handles a streaming chat completion request
// Supports actions: "new" (default), "edit", "regenerate"
func (s *ChatService) ChatStream(ctx context.Context, req *models.ChatCompletionRequest) (<-chan *models.ChatCompletionChunk, error) {
	if len(req.Messages) == 0 && req.Action != "regenerate" {
		return nil, ErrNoMessages
	}

	// Determine action
	action := req.Action
	if action == "" {
		action = "new"
	}

	var conv *models.Conversation
	var assistantMsg *models.Message
	var err error

	switch action {
	case "edit":
		// Edit a user message - create new branch
		conv, assistantMsg, err = s.handleEditAction(req)
	case "regenerate":
		// Regenerate an assistant response - create sibling branch
		conv, assistantMsg, err = s.handleRegenerateAction(req)
	default:
		// Normal new message
		conv, assistantMsg, err = s.handleNewAction(req)
	}

	if err != nil {
		return nil, err
	}

	// Create output channel
	chunks := make(chan *models.ChatCompletionChunk, 100)

	// Create cancellable context
	streamCtx, cancel := context.WithCancel(ctx)

	// Register active stream
	session := &StreamSession{
		ConversationID: conv.ID,
		MessageID:      assistantMsg.ID,
		Cancel:         cancel,
		StartedAt:      time.Now(),
	}
	s.activeStreams.Store(conv.ID, session)

	// Run streaming in goroutine
	go func() {
		defer close(chunks)
		defer s.activeStreams.Delete(conv.ID)
		defer cancel()

		// runStreamingAgent returns the final message being processed
		finalMsg, err := s.runStreamingAgent(streamCtx, req, conv, assistantMsg, chunks)
		if err != nil {
			s.logger.Error("Streaming agent error", "error", err, "conversationID", conv.ID)

			// Use the final message returned by runStreamingAgent
			targetMsg := finalMsg
			if targetMsg == nil {
				targetMsg = assistantMsg
			}

			// Convert error to user-friendly message
			errorMsg := s.formatAgentError(err)

			// Append error to existing content using Parts
			existingText := targetMsg.GetTextContent()
			if existingText != "" {
				targetMsg.AddTextPart(errorMsg, targetMsg.GetMaxRoundIndex())
			} else {
				targetMsg.AddTextPart(errorMsg, 0)
			}
			targetMsg.Status = models.MessageStatusError
			targetMsg.FinishReason = models.FinishReasonStop
			s.SaveMessage(targetMsg)

			// Send error content chunk so it displays in the chat
			chunks <- &models.ChatCompletionChunk{
				ID:             targetMsg.ID,
				Object:         "chat.completion.chunk",
				Created:        time.Now().Unix(),
				Model:          req.Model,
				ConversationID: conv.ID,
				Choices: []models.ChatCompletionChunkChoice{
					{
						Index: 0,
						Delta: models.ChatCompletionChunkDelta{
							Content: "\n\n" + errorMsg,
						},
					},
				},
			}

			// Send finish chunk with stop reason (OpenAI compatible)
			chunks <- &models.ChatCompletionChunk{
				ID:             targetMsg.ID,
				Object:         "chat.completion.chunk",
				Created:        time.Now().Unix(),
				Model:          req.Model,
				ConversationID: conv.ID,
				Choices: []models.ChatCompletionChunkChoice{
					{
						Index:        0,
						Delta:        models.ChatCompletionChunkDelta{},
						FinishReason: models.FinishReasonStop,
					},
				},
			}
		}

		// Update conversation timestamp
		s.db.Model(&models.Conversation{}).Where("id = ?", conv.ID).Update("updated_at", time.Now())
	}()

	return chunks, nil
}

// handleNewAction handles normal new message flow
func (s *ChatService) handleNewAction(req *models.ChatCompletionRequest) (*models.Conversation, *models.Message, error) {
	// Get or create conversation
	conv, err := s.getOrCreateConversation(req)
	if err != nil {
		return nil, nil, err
	}

	// Determine parent message ID (last message in conversation)
	var parentID *string
	if req.ParentID != "" {
		parentID = &req.ParentID
	} else {
		// Find the last message
		var lastMsg models.Message
		if err := s.db.Where("conversation_id = ?", conv.ID).
			Order("created_at DESC").First(&lastMsg).Error; err == nil {
			parentID = &lastMsg.ID
		}
	}

	// Save user message
	userMsg := req.Messages[len(req.Messages)-1]
	if userMsg.Role == models.RoleUser {
		// Convert content to Parts
		var parts []models.MessagePart
		if content, ok := userMsg.Content.(string); ok && content != "" {
			parts = append(parts, models.MessagePart{
				Type: models.PartTypeText,
				Text: content,
			})
		}

		userMsgModel := &models.Message{
			ID:             uuid.New().String(),
			ConversationID: conv.ID,
			Role:           models.RoleUser,
			Parts:          parts,
			Name:           userMsg.Name,
			Status:         models.MessageStatusCompleted,
			ParentID:       parentID,
		}
		if err := s.SaveMessage(userMsgModel); err != nil {
			return nil, nil, err
		}
		// Update parentID for assistant message
		parentID = &userMsgModel.ID
	}

	// Create assistant message placeholder
	assistantMsg := &models.Message{
		ID:             uuid.New().String(),
		ConversationID: conv.ID,
		Role:           models.RoleAssistant,
		Status:         models.MessageStatusStreaming,
		ParentID:       parentID,
	}
	if err := s.SaveMessage(assistantMsg); err != nil {
		return nil, nil, err
	}

	return conv, assistantMsg, nil
}

// handleEditAction handles editing a user message (creates a new branch)
func (s *ChatService) handleEditAction(req *models.ChatCompletionRequest) (*models.Conversation, *models.Message, error) {
	if req.SourceID == "" {
		return nil, nil, errors.New("source_id required for edit action")
	}

	// Get the original message being edited
	originalMsg, err := s.GetMessage(req.SourceID)
	if err != nil {
		return nil, nil, err
	}

	if originalMsg.Role != models.RoleUser {
		return nil, nil, errors.New("can only edit user messages")
	}

	// Get conversation
	conv, err := s.GetConversation(originalMsg.ConversationID)
	if err != nil {
		return nil, nil, err
	}

	// Create new user message as a branch (sibling to the original)
	var newContent string
	if len(req.Messages) > 0 {
		if content, ok := req.Messages[len(req.Messages)-1].Content.(string); ok {
			newContent = content
		}
	}

	// Convert content to Parts
	var parts []models.MessagePart
	if newContent != "" {
		parts = append(parts, models.MessagePart{
			Type: models.PartTypeText,
			Text: newContent,
		})
	}

	newUserMsg := &models.Message{
		ID:     uuid.New().String(),
		Role:   models.RoleUser,
		Parts:  parts,
		Status: models.MessageStatusCompleted,
	}

	// Create as a branch (sibling to the original message)
	if err := s.CreateBranch(originalMsg.ConversationID, originalMsg.ParentID, newUserMsg); err != nil {
		return nil, nil, err
	}

	// Create assistant message as child of the new user message
	parentID := newUserMsg.ID
	assistantMsg := &models.Message{
		ID:             uuid.New().String(),
		ConversationID: conv.ID,
		Role:           models.RoleAssistant,
		Status:         models.MessageStatusStreaming,
		ParentID:       &parentID,
	}
	if err := s.SaveMessage(assistantMsg); err != nil {
		return nil, nil, err
	}

	// Update request conversation ID
	req.ConversationID = conv.ID

	return conv, assistantMsg, nil
}

// handleRegenerateAction handles regenerating an assistant response (creates sibling branch)
func (s *ChatService) handleRegenerateAction(req *models.ChatCompletionRequest) (*models.Conversation, *models.Message, error) {
	if req.SourceID == "" {
		return nil, nil, errors.New("source_id required for regenerate action")
	}

	// Get the original assistant message
	originalMsg, err := s.GetMessage(req.SourceID)
	if err != nil {
		return nil, nil, err
	}

	if originalMsg.Role != models.RoleAssistant {
		return nil, nil, errors.New("can only regenerate assistant messages")
	}

	// Get conversation
	conv, err := s.GetConversation(originalMsg.ConversationID)
	if err != nil {
		return nil, nil, err
	}

	// Create new assistant message as a branch (sibling to the original)
	assistantMsg := &models.Message{
		ID:     uuid.New().String(),
		Role:   models.RoleAssistant,
		Status: models.MessageStatusStreaming,
	}

	if err := s.CreateBranch(originalMsg.ConversationID, originalMsg.ParentID, assistantMsg); err != nil {
		return nil, nil, err
	}

	// Update request conversation ID
	req.ConversationID = conv.ID

	return conv, assistantMsg, nil
}

// CancelStream cancels an active stream
func (s *ChatService) CancelStream(conversationID string) error {
	if session, ok := s.activeStreams.Load(conversationID); ok {
		sess := session.(*StreamSession)
		sess.Cancel()

		// Update message status
		s.UpdateMessageStatus(sess.MessageID, models.MessageStatusCompleted, models.FinishReasonCancelled)

		s.activeStreams.Delete(conversationID)
		return nil
	}
	return nil
}

// ========== Internal helpers ==========

func (s *ChatService) getOrCreateConversation(req *models.ChatCompletionRequest) (*models.Conversation, error) {
	if req.ConversationID != "" {
		return s.GetConversation(req.ConversationID)
	}

	// Create new conversation
	return s.CreateConversation(&models.CreateConversationRequest{
		WorkspaceID: req.WorkspaceID,
		RoomID:      req.RoomID,
		ModelID:     req.Model,
		Title:       "New Chat",
	})
}

func (s *ChatService) saveUserMessage(conversationID string, msg *models.ChatCompletionMessage) error {
	// Convert content to Parts
	var parts []models.MessagePart
	if content, ok := msg.Content.(string); ok && content != "" {
		parts = append(parts, models.MessagePart{
			Type: models.PartTypeText,
			Text: content,
		})
	}

	userMsg := &models.Message{
		ID:             uuid.New().String(),
		ConversationID: conversationID,
		Role:           models.RoleUser,
		Parts:          parts,
		Name:           msg.Name,
		Status:         models.MessageStatusCompleted,
	}
	return s.SaveMessage(userMsg)
}

func (s *ChatService) buildConversationHistory(conversationID string) ([]*schema.Message, error) {
	// Get all messages for the conversation
	messages, err := s.GetMessages(conversationID)
	if err != nil {
		return nil, err
	}

	history := make([]*schema.Message, 0)
	for _, msg := range messages {
		// Convert each message to schema messages (may produce multiple for tool calls)
		schemaMessages := s.messageToSchemaMessages(&msg)
		history = append(history, schemaMessages...)
	}

	return history, nil
}

// messageToSchemaMessages converts a db.Message with Parts to one or more schema.Message
// A single message with tool_call + tool_result parts produces: assistant (with tool_calls) + tool messages
func (s *ChatService) messageToSchemaMessages(msg *models.Message) []*schema.Message {
	if msg.Parts == nil || len(msg.Parts) == 0 {
		// Empty message - return minimal message
		return []*schema.Message{{
			Role: schema.RoleType(msg.Role),
			Name: msg.Name,
		}}
	}

	// For user/system messages - simple text concatenation
	if msg.Role == db.RoleUser || msg.Role == db.RoleSystem {
		var content string
		for _, part := range msg.Parts {
			if part.Type == db.PartTypeText && part.Text != "" {
				if content != "" {
					content += "\n"
				}
				content += part.Text
			}
		}
		return []*schema.Message{{
			Role:    schema.RoleType(msg.Role),
			Content: content,
			Name:    msg.Name,
		}}
	}

	// For assistant messages - may have multiple rounds with tool calls
	result := make([]*schema.Message, 0)

	// First, build a map of tool_call_id -> tool_result for validation
	toolResultMap := make(map[string]*db.ToolResultPart)
	for _, part := range msg.Parts {
		if part.Type == db.PartTypeToolResult && part.ToolResult != nil {
			toolResultMap[part.ToolResult.ToolCallID] = part.ToolResult
		}
	}

	// Group parts by round index
	maxRound := 0
	for _, part := range msg.Parts {
		if part.Index > maxRound {
			maxRound = part.Index
		}
	}

	for round := 0; round <= maxRound; round++ {
		// Collect parts for this round
		var textContent, reasoningContent string
		var toolCalls []schema.ToolCall
		var toolResults []*schema.Message

		for _, part := range msg.Parts {
			if part.Index != round {
				continue
			}

			switch part.Type {
			case db.PartTypeText:
				if part.Text != "" {
					if textContent != "" {
						textContent += "\n"
					}
					textContent += part.Text
				}
			case db.PartTypeReasoning:
				if part.Text != "" {
					if reasoningContent != "" {
						reasoningContent += "\n"
					}
					reasoningContent += part.Text
				}
			case db.PartTypeToolCall:
				// Only include tool_call if we have a corresponding tool_result
				if part.ToolCall != nil {
					if _, hasResult := toolResultMap[part.ToolCall.ID]; hasResult {
						toolCalls = append(toolCalls, schema.ToolCall{
							ID:   part.ToolCall.ID,
							Type: "function",
							Function: schema.FunctionCall{
								Name:      part.ToolCall.Name,
								Arguments: part.ToolCall.Arguments,
							},
						})
					} else {
						s.logger.Debug("Skipping tool_call without result",
							"toolCallID", part.ToolCall.ID,
							"toolName", part.ToolCall.Name)
					}
				}
			case db.PartTypeToolResult:
				if part.ToolResult != nil {
					toolResults = append(toolResults, &schema.Message{
						Role:       schema.Tool,
						ToolCallID: part.ToolResult.ToolCallID,
						ToolName:   part.ToolResult.Name,
						Content:    part.ToolResult.Content,
					})
				}
			}
		}

		// Create assistant message for this round (if has content or tool calls)
		if textContent != "" || reasoningContent != "" || len(toolCalls) > 0 {
			assistantMsg := &schema.Message{
				Role:             schema.Assistant,
				Content:          textContent,
				ReasoningContent: reasoningContent,
				ToolCalls:        toolCalls,
			}
			result = append(result, assistantMsg)
		}

		// Add tool result messages after the assistant message
		result = append(result, toolResults...)
	}

	return result
}

func (s *ChatService) loadWorkspaceTools(ctx context.Context, workspaceID string) ([]tool.InvokableTool, error) {
	s.logger.Info("loadWorkspaceTools called", "workspaceID", workspaceID, "hasToolLoader", s.toolLoader != nil)

	if workspaceID == "" {
		s.logger.Warn("workspaceID is empty, skipping tool loading")
		return nil, nil
	}
	if s.toolLoader == nil {
		s.logger.Warn("toolLoader is nil, skipping tool loading")
		return nil, nil
	}

	workspace, err := s.workspaceService.Get(ctx, workspaceID)
	if err != nil {
		s.logger.Error("Failed to get workspace", "workspaceID", workspaceID, "error", err)
		return nil, err
	}

	s.logger.Info("Got workspace for tool loading",
		"workspaceID", workspaceID,
		"workspaceName", workspace.Name,
		"toolsCount", len(workspace.Tools))

	if len(workspace.Tools) == 0 {
		s.logger.Warn("Workspace has no tools configured", "workspaceID", workspaceID)
		return nil, nil
	}

	tools, err := s.toolLoader.LoadWorkspaceTools(ctx, workspaceID, workspace.Tools)
	if err != nil {
		s.logger.Error("toolLoader.LoadWorkspaceTools failed", "error", err)
		return nil, err
	}

	s.logger.Info("Workspace tools loaded", "workspaceID", workspaceID, "toolCount", len(tools))
	return tools, nil
}

// formatAgentError converts agent errors to user-friendly messages
func (s *ChatService) formatAgentError(err error) string {
	errStr := err.Error()

	// Check for common error patterns and provide friendly messages
	switch {
	case strings.Contains(errStr, "exceeds max iterations"):
		return "⚠️ The assistant reached the maximum number of tool call iterations. The task may be too complex or require manual intervention. Please try breaking down your request into smaller steps."

	case strings.Contains(errStr, "context canceled"):
		return "⚠️ The request was cancelled."

	case strings.Contains(errStr, "context deadline exceeded"):
		return "⚠️ The request timed out. Please try again or simplify your request."

	case strings.Contains(errStr, "rate limit"):
		return "⚠️ Rate limit exceeded. Please wait a moment and try again."

	case strings.Contains(errStr, "insufficient_quota"):
		return "⚠️ API quota exceeded. Please check your API key balance."

	case strings.Contains(errStr, "invalid_api_key"):
		return "⚠️ Invalid API key. Please check your API key configuration."

	case strings.Contains(errStr, "model not found"):
		return "⚠️ The selected model is not available. Please choose a different model."

	case strings.Contains(errStr, "connection refused") || strings.Contains(errStr, "no such host"):
		return "⚠️ Failed to connect to the AI service. Please check your network connection."

	case strings.Contains(errStr, "tool") && strings.Contains(errStr, "failed"):
		// Extract tool name if possible
		return "⚠️ A tool execution failed. " + extractToolError(errStr)

	default:
		// For unknown errors, show a simplified version
		return "⚠️ An error occurred: " + simplifyErrorMessage(errStr)
	}
}

// extractToolError extracts a more readable error from tool failures
func extractToolError(errStr string) string {
	// Try to find the actual error message after common prefixes
	if idx := strings.LastIndex(errStr, "err="); idx != -1 {
		return errStr[idx+4:]
	}
	return errStr
}

// simplifyErrorMessage removes verbose technical details from error messages
func simplifyErrorMessage(errStr string) string {
	// Remove node path information
	if idx := strings.Index(errStr, "\n------------------------"); idx != -1 {
		errStr = errStr[:idx]
	}

	// Remove [NodeRunError] prefix
	errStr = strings.ReplaceAll(errStr, "[NodeRunError] ", "")

	// Truncate if too long
	if len(errStr) > 200 {
		errStr = errStr[:200] + "..."
	}

	return errStr
}

// getChatModel creates a chat model based on modelID
func (s *ChatService) getChatModel(ctx context.Context, modelID string) (model.ToolCallingChatModel, error) {
	if modelID == "" {
		return nil, ErrModelNotConfigured
	}

	modelConfig, err := s.modelService.GetModelConfig(modelID)
	if err != nil {
		return nil, fmt.Errorf("failed to get model config: %w", err)
	}
	if modelConfig == nil {
		return nil, fmt.Errorf("model not found: %s", modelID)
	}

	// Use ModelService to create the model
	return s.modelService.CreateChatModel(ctx, modelConfig)
}

// getSystemPrompt returns the system prompt for the workspace
func (s *ChatService) getSystemPrompt(workspaceID string) string {
	return `You are a helpful AI assistant working in a development workspace.

LANGUAGE RULE (CRITICAL):
- Always respond in the SAME language the user uses
- If user writes in Chinese, respond in Chinese
- If user writes in English, respond in English

Your capabilities include:
1. Help with coding and development tasks
2. Execute commands in the workspace environment
3. Read and write files
4. Analyze code and provide suggestions
5. Help with debugging and troubleshooting

When using tools:
- Use appropriate tools to help complete user requests
- For file operations, use the file tools
- For command execution, use the exec tools
- Always verify results before reporting success

Be professional, helpful, and concise in your responses.`
}

func (s *ChatService) runAgent(ctx context.Context, modelID string, history []*schema.Message, workspaceTools []tool.InvokableTool, assistantMsg *models.Message) (*models.ChatCompletionResponse, error) {
	// Get the chat model
	chatModel, err := s.getChatModel(ctx, modelID)
	if err != nil {
		return nil, fmt.Errorf("failed to get chat model: %w", err)
	}

	// If we have tools, bind them to the model
	if len(workspaceTools) > 0 {
		toolsInfo := make([]*schema.ToolInfo, 0, len(workspaceTools))
		for _, t := range workspaceTools {
			info, err := t.Info(ctx)
			if err != nil {
				s.logger.Warn("Failed to get tool info", "error", err)
				continue
			}
			toolsInfo = append(toolsInfo, info)
		}
		s.logger.Debug("Binding tools to model", "count", len(toolsInfo))

		if len(toolsInfo) > 0 {
			chatModel, err = chatModel.WithTools(toolsInfo)
			if err != nil {
				return nil, fmt.Errorf("failed to bind tools: %w", err)
			}
		}
	} else {
		s.logger.Debug("No workspace tools to bind")
	}

	// Generate response
	response, err := chatModel.Generate(ctx, history)
	if err != nil {
		return nil, fmt.Errorf("failed to generate response: %w", err)
	}

	// Update assistant message using Parts
	if response.ReasoningContent != "" {
		assistantMsg.AddReasoningPart(response.ReasoningContent, 0)
	}
	if response.Content != "" {
		assistantMsg.AddTextPart(response.Content, 0)
	}
	assistantMsg.Status = models.MessageStatusCompleted
	assistantMsg.FinishReason = models.FinishReasonStop

	// Handle tool calls if any
	if len(response.ToolCalls) > 0 {
		assistantMsg.FinishReason = models.FinishReasonToolCalls
		for _, tc := range response.ToolCalls {
			assistantMsg.AddToolCallPart(tc.ID, tc.Function.Name, tc.Function.Arguments, 0)
		}
	}

	// Update usage if available
	if response.ResponseMeta != nil && response.ResponseMeta.Usage != nil {
		assistantMsg.Usage = db.TokenUsage{
			PromptTokens:     response.ResponseMeta.Usage.PromptTokens,
			CompletionTokens: response.ResponseMeta.Usage.CompletionTokens,
			TotalTokens:      response.ResponseMeta.Usage.TotalTokens,
		}
	}

	// Save message
	if err := s.SaveMessage(assistantMsg); err != nil {
		s.logger.Error("Failed to save assistant message", "error", err)
	}

	// Convert usage for API response
	var usage *models.TokenUsage
	if assistantMsg.Usage.TotalTokens > 0 {
		usage = &models.TokenUsage{
			PromptTokens:     assistantMsg.Usage.PromptTokens,
			CompletionTokens: assistantMsg.Usage.CompletionTokens,
			TotalTokens:      assistantMsg.Usage.TotalTokens,
		}
	}

	return &models.ChatCompletionResponse{
		ID:             assistantMsg.ID,
		Object:         "chat.completion",
		Created:        time.Now().Unix(),
		Model:          modelID,
		ConversationID: assistantMsg.ConversationID,
		Choices: []models.ChatCompletionChoice{
			{
				Index:        0,
				Message:      s.ToAPIMessage(assistantMsg),
				FinishReason: assistantMsg.FinishReason,
			},
		},
		Usage: usage,
	}, nil
}

func (s *ChatService) runStreamingAgent(ctx context.Context, req *models.ChatCompletionRequest, conv *models.Conversation, assistantMsg *models.Message, chunks chan<- *models.ChatCompletionChunk) (*models.Message, error) {
	s.logger.Info("runStreamingAgent started",
		"workspaceID", req.WorkspaceID,
		"conversationID", conv.ID,
		"modelID", req.Model)

	// Load workspace tools
	workspaceTools, err := s.loadWorkspaceTools(ctx, req.WorkspaceID)
	if err != nil {
		s.logger.Warn("Failed to load workspace tools", "error", err)
	}

	s.logger.Info("After loadWorkspaceTools",
		"toolCount", len(workspaceTools),
		"hasTools", len(workspaceTools) > 0)

	// Build conversation history
	history, err := s.buildConversationHistory(conv.ID)
	if err != nil {
		return assistantMsg, err
	}

	// Get model ID
	modelID := req.Model
	if modelID == "" {
		modelID = conv.ModelID
	}
	if modelID == "" {
		return assistantMsg, ErrModelNotConfigured
	}

	// Get the chat model
	chatModel, err := s.getChatModel(ctx, modelID)
	if err != nil {
		return assistantMsg, fmt.Errorf("failed to get chat model: %w", err)
	}

	// Convert []tool.InvokableTool to []tool.BaseTool
	baseTools := make([]tool.BaseTool, len(workspaceTools))
	for i, t := range workspaceTools {
		baseTools[i] = t
	}

	// Get system prompt
	systemPrompt := s.getSystemPrompt(req.WorkspaceID)

	// Create agent with tools
	agent, err := adk.NewChatModelAgent(ctx, &adk.ChatModelAgentConfig{
		Name:        "Workspace Assistant",
		Description: "An AI assistant that helps with coding and development tasks in the workspace",
		Instruction: systemPrompt,
		Model:       chatModel,
		ToolsConfig: adk.ToolsConfig{ToolsNodeConfig: compose.ToolsNodeConfig{Tools: baseTools}},
	})
	if err != nil {
		return assistantMsg, fmt.Errorf("failed to create agent: %w", err)
	}

	// Send initial chunk with role
	chunks <- &models.ChatCompletionChunk{
		ID:             assistantMsg.ID,
		Object:         "chat.completion.chunk",
		Created:        time.Now().Unix(),
		Model:          modelID,
		ConversationID: conv.ID,
		Choices: []models.ChatCompletionChunkChoice{
			{
				Index: 0,
				Delta: models.ChatCompletionChunkDelta{
					Role: models.RoleAssistant,
				},
			},
		},
	}

	// Run agent with streaming
	iter := agent.Run(ctx, &adk.AgentInput{Messages: history, EnableStreaming: true})

	// Track current assistant message
	currentAssistantMsg := assistantMsg

	for {
		select {
		case <-ctx.Done():
			s.UpdateMessageStatus(currentAssistantMsg.ID, models.MessageStatusCompleted, models.FinishReasonCancelled)
			return currentAssistantMsg, ctx.Err()
		default:
		}

		part, ok := iter.Next()
		if !ok {
			break
		}
		if part.Err != nil {
			s.logger.Error("Agent iteration error", "error", part.Err)
			return currentAssistantMsg, fmt.Errorf("agent error: %w", part.Err)
		}

		// Check the role of this message output
		msgRole := part.Output.MessageOutput.Role

		if msgRole == schema.Tool {
			// This is a tool execution result
			fullMsg, err := part.Output.MessageOutput.GetMessage()
			if err != nil {
				s.logger.Error("Failed to get tool result message", "error", err)
				continue
			}

			s.logger.Info("Received tool result", "toolCallID", fullMsg.ToolCallID, "toolName", fullMsg.ToolName)

			// Get current round index from the assistant message
			roundIndex := currentAssistantMsg.GetMaxRoundIndex()

			// Add tool result to current assistant message's parts
			currentAssistantMsg.AddToolResultPart(fullMsg.ToolCallID, fullMsg.ToolName, fullMsg.Content, roundIndex)
			s.SaveMessage(currentAssistantMsg)

			// Send tool result chunk to frontend
			chunks <- &models.ChatCompletionChunk{
				ID:             currentAssistantMsg.ID,
				Object:         "chat.completion.chunk",
				Created:        time.Now().Unix(),
				Model:          modelID,
				ConversationID: conv.ID,
				Choices: []models.ChatCompletionChunkChoice{
					{
						Index: 0,
						Delta: models.ChatCompletionChunkDelta{
							Role:       models.RoleTool,
							Content:    fullMsg.Content,
							ToolCallID: fullMsg.ToolCallID,
						},
					},
				},
			}

			// Continue to next iteration - more content may follow
		} else if msgRole == schema.Assistant {
			// This is an assistant message - handle streaming content
			var iterChunks []*schema.Message
			if part.Output.MessageOutput.MessageStream != nil {
				for {
					chunk, err := part.Output.MessageOutput.MessageStream.Recv()
					if errors.Is(err, io.EOF) {
						break
					}
					if err != nil {
						s.logger.Error("Agent stream error", "error", err)
						return currentAssistantMsg, fmt.Errorf("stream error: %w", err)
					}

					iterChunks = append(iterChunks, chunk)

					// Send content and reasoning deltas to client
					if chunk.Content != "" {
						chunks <- &models.ChatCompletionChunk{
							ID:             currentAssistantMsg.ID,
							Object:         "chat.completion.chunk",
							Created:        time.Now().Unix(),
							Model:          modelID,
							ConversationID: conv.ID,
							Choices: []models.ChatCompletionChunkChoice{
								{
									Index: 0,
									Delta: models.ChatCompletionChunkDelta{
										Content: chunk.Content,
									},
								},
							},
						}
					}
					if chunk.ReasoningContent != "" {
						chunks <- &models.ChatCompletionChunk{
							ID:             currentAssistantMsg.ID,
							Object:         "chat.completion.chunk",
							Created:        time.Now().Unix(),
							Model:          modelID,
							ConversationID: conv.ID,
							Choices: []models.ChatCompletionChunkChoice{
								{
									Index: 0,
									Delta: models.ChatCompletionChunkDelta{
										ReasoningContent: chunk.ReasoningContent,
									},
								},
							},
						}
					}
				}
			}

			// Concat streaming chunks to get the full message
			streamedMsg, err := schema.ConcatMessages(iterChunks)
			if err != nil {
				s.logger.Error("Failed to concat messages", "error", err)
				return currentAssistantMsg, fmt.Errorf("failed to concat messages: %w", err)
			}

			// Get current round index
			roundIndex := currentAssistantMsg.GetMaxRoundIndex()

			// Update current assistant message parts
			if streamedMsg.ReasoningContent != "" {
				currentAssistantMsg.AddReasoningPart(streamedMsg.ReasoningContent, roundIndex)
			}
			if streamedMsg.Content != "" {
				currentAssistantMsg.AddTextPart(streamedMsg.Content, roundIndex)
			}

			// Handle tool calls if present
			if len(streamedMsg.ToolCalls) > 0 {
				// Add tool calls to parts
				for i, tc := range streamedMsg.ToolCalls {
					currentAssistantMsg.AddToolCallPart(tc.ID, tc.Function.Name, tc.Function.Arguments, roundIndex)

					// Send tool call chunk to client with index
					tcIndex := i
					chunks <- &models.ChatCompletionChunk{
						ID:             currentAssistantMsg.ID,
						Object:         "chat.completion.chunk",
						Created:        time.Now().Unix(),
						Model:          modelID,
						ConversationID: conv.ID,
						Choices: []models.ChatCompletionChunkChoice{
							{
								Index: 0,
								Delta: models.ChatCompletionChunkDelta{
									ToolCalls: []models.ToolCall{{
										Index: &tcIndex,
										ID:    tc.ID,
										Type:  tc.Type,
										Function: models.FunctionCall{
											Name:      tc.Function.Name,
											Arguments: tc.Function.Arguments,
										},
									}},
								},
							},
						},
					}
				}
				// Save current state - tool execution will happen in next iteration
				s.SaveMessage(currentAssistantMsg)
			} else {
				// No tool calls - this is the final response
				currentAssistantMsg.Status = models.MessageStatusCompleted
				currentAssistantMsg.FinishReason = models.FinishReasonStop
				s.SaveMessage(currentAssistantMsg)
			}
		}
	}

	// After loop ends, ensure message is properly finalized
	if currentAssistantMsg.Status != models.MessageStatusCompleted {
		currentAssistantMsg.Status = models.MessageStatusCompleted
		currentAssistantMsg.FinishReason = models.FinishReasonStop
		s.SaveMessage(currentAssistantMsg)
	}

	// Send final chunk
	chunks <- &models.ChatCompletionChunk{
		ID:             currentAssistantMsg.ID,
		Object:         "chat.completion.chunk",
		Created:        time.Now().Unix(),
		Model:          modelID,
		ConversationID: conv.ID,
		Choices: []models.ChatCompletionChunkChoice{
			{
				Index:        0,
				Delta:        models.ChatCompletionChunkDelta{},
				FinishReason: models.FinishReasonStop,
			},
		},
	}

	return currentAssistantMsg, nil
}

// ========== Conversion helpers ==========

// ToAPIMessage converts a database Message to API ChatCompletionMessage
func (s *ChatService) ToAPIMessage(msg *models.Message) models.ChatCompletionMessage {
	apiMsg := models.ChatCompletionMessage{
		Role: msg.Role,
		Name: msg.Name,
	}

	// Extract content from Parts
	apiMsg.Content = msg.GetTextContent()
	apiMsg.ReasoningContent = msg.GetReasoningContent()

	// Extract tool calls from Parts and convert to models.ToolCall
	dbToolCalls := msg.GetToolCalls()
	if len(dbToolCalls) > 0 {
		apiMsg.ToolCalls = make([]models.ToolCall, len(dbToolCalls))
		for i, tc := range dbToolCalls {
			apiMsg.ToolCalls[i] = models.ToolCall{
				ID:   tc.ID,
				Type: tc.Type,
				Function: models.FunctionCall{
					Name:      tc.Function.Name,
					Arguments: tc.Function.Arguments,
				},
			}
		}
	}

	return apiMsg
}

// ToAPIMessages converts database Messages to API format
func (s *ChatService) ToAPIMessages(messages []models.Message) []models.ChatCompletionMessage {
	result := make([]models.ChatCompletionMessage, len(messages))
	for i, msg := range messages {
		result[i] = s.ToAPIMessage(&msg)
	}
	return result
}
