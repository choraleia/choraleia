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
	LoadWorkspaceTools(ctx context.Context, workspaceID string, conversationID string, toolConfigs []models.WorkspaceTool) ([]tool.InvokableTool, error)
}

// ChatService handles workspace chat operations
type ChatService struct {
	db               *gorm.DB
	modelService     *ModelService
	workspaceService *WorkspaceService
	assetService     *AssetService
	toolLoader       ToolLoader
	browserService   *BrowserService
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

	// History for reconnection - stores chunks for replay
	EventHistory   []*StreamEvent // Chunks for replay on reconnect
	MaxHistorySize int            // Max events to keep in history

	// Subscriber management for continue/reconnect
	subscribers   map[chan *models.ChatCompletionChunk]struct{}
	subscribersMu sync.RWMutex
	done          chan struct{} // Closed when streaming is complete
	Model         string        // Model ID for chunks
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

// SetBrowserService sets the browser service for context injection
func (s *ChatService) SetBrowserService(browserService *BrowserService) {
	s.browserService = browserService
}

// SetAssetService sets the asset service for asset info lookup
func (s *ChatService) SetAssetService(assetService *AssetService) {
	s.assetService = assetService
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
	workspaceTools, err := s.loadWorkspaceTools(ctx, req.WorkspaceID, conv.ID)
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
		MaxHistorySize: 1000, // Keep last 1000 chunks for replay
		EventHistory:   make([]*StreamEvent, 0, 1000),
		subscribers:    make(map[chan *models.ChatCompletionChunk]struct{}),
		done:           make(chan struct{}),
		Model:          req.Model,
	}
	s.activeStreams.Store(conv.ID, session)

	// Run streaming in goroutine
	go func() {
		defer close(chunks)
		defer func() {
			// Close done channel to signal all subscribers
			close(session.done)
			// Close all subscriber channels
			session.subscribersMu.Lock()
			for ch := range session.subscribers {
				close(ch)
			}
			session.subscribers = nil
			session.subscribersMu.Unlock()
			// Remove from active streams
			s.activeStreams.Delete(conv.ID)
		}()
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
			errorChunk := &models.ChatCompletionChunk{
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
			s.updateStreamBuffer(conv.ID, errorChunk)
			chunks <- errorChunk

			// Send finish chunk with stop reason (OpenAI compatible)
			finishChunk := &models.ChatCompletionChunk{
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
			s.updateStreamBuffer(conv.ID, finishChunk)
			chunks <- finishChunk
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

// IsStreaming checks if a conversation has an active stream
func (s *ChatService) IsStreaming(conversationID string) bool {
	_, ok := s.activeStreams.Load(conversationID)
	return ok
}

// StreamState represents the current state of a streaming session
type StreamState struct {
	IsStreaming    bool       `json:"is_streaming"`
	ConversationID string     `json:"conversation_id"`
	MessageID      string     `json:"message_id,omitempty"`
	LastEventID    int64      `json:"last_event_id"`
	StartedAt      *time.Time `json:"started_at,omitempty"`
}

// GetStreamState returns the current streaming state for reconnection
func (s *ChatService) GetStreamState(conversationID string) *StreamState {
	state := &StreamState{
		ConversationID: conversationID,
		IsStreaming:    false,
	}

	session, ok := s.activeStreams.Load(conversationID)
	if !ok {
		return state
	}

	sess := session.(*StreamSession)
	sess.mu.Lock()
	defer sess.mu.Unlock()

	state.IsStreaming = true
	state.MessageID = sess.MessageID
	state.LastEventID = sess.LastEventID
	state.StartedAt = &sess.StartedAt

	return state
}

// GetStreamEvents returns buffered events since a given event ID for reconnection
func (s *ChatService) GetStreamEvents(conversationID string, sinceEventID int64) []*StreamEvent {
	session, ok := s.activeStreams.Load(conversationID)
	if !ok {
		return nil
	}

	sess := session.(*StreamSession)
	sess.mu.Lock()
	defer sess.mu.Unlock()

	// Find events since the given ID
	var events []*StreamEvent
	for _, evt := range sess.EventHistory {
		if evt.ID > sinceEventID {
			events = append(events, evt)
		}
	}
	return events
}

// updateStreamBuffer appends a chunk to the session history for replay on reconnection
func (s *ChatService) updateStreamBuffer(conversationID string, chunk *models.ChatCompletionChunk) {
	session, ok := s.activeStreams.Load(conversationID)
	if !ok {
		return
	}

	sess := session.(*StreamSession)
	sess.mu.Lock()

	// Update message ID if needed
	if chunk.ID != "" && sess.MessageID == "" {
		sess.MessageID = chunk.ID
	}

	// Increment event ID and add chunk to history
	sess.LastEventID++
	event := &StreamEvent{
		ID:   sess.LastEventID,
		Type: "chunk",
		Data: chunk,
	}

	// Add to history with size limit
	if len(sess.EventHistory) >= sess.MaxHistorySize {
		sess.EventHistory = sess.EventHistory[1:]
	}
	sess.EventHistory = append(sess.EventHistory, event)

	sess.mu.Unlock()

	// Broadcast to all subscribers (non-blocking)
	sess.subscribersMu.RLock()
	for ch := range sess.subscribers {
		select {
		case ch <- chunk:
		default:
			// Skip if subscriber is slow
		}
	}
	sess.subscribersMu.RUnlock()
}

// SubscribeToStream subscribes to an active stream and returns a channel for chunks
// Returns nil if no active stream exists
func (s *ChatService) SubscribeToStream(conversationID string) (<-chan *models.ChatCompletionChunk, func()) {
	session, ok := s.activeStreams.Load(conversationID)
	if !ok {
		return nil, nil
	}

	sess := session.(*StreamSession)

	// Check if already done
	select {
	case <-sess.done:
		return nil, nil
	default:
	}

	// Create subscriber channel
	ch := make(chan *models.ChatCompletionChunk, 100)

	sess.subscribersMu.Lock()
	if sess.subscribers == nil {
		sess.subscribersMu.Unlock()
		return nil, nil
	}
	sess.subscribers[ch] = struct{}{}
	sess.subscribersMu.Unlock()

	// Return unsubscribe function
	unsubscribe := func() {
		sess.subscribersMu.Lock()
		delete(sess.subscribers, ch)
		sess.subscribersMu.Unlock()
	}

	return ch, unsubscribe
}

// GetStreamDoneChannel returns a channel that's closed when the stream is done
func (s *ChatService) GetStreamDoneChannel(conversationID string) <-chan struct{} {
	session, ok := s.activeStreams.Load(conversationID)
	if !ok {
		// Return already closed channel
		ch := make(chan struct{})
		close(ch)
		return ch
	}
	return session.(*StreamSession).done
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
		// Empty message - skip it entirely to avoid API errors
		// (e.g., DeepSeek requires reasoning_content for all assistant messages)
		s.logger.Debug("Skipping message with empty parts",
			"messageID", msg.ID,
			"role", msg.Role)
		return []*schema.Message{}
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

func (s *ChatService) loadWorkspaceTools(ctx context.Context, workspaceID string, conversationID string) ([]tool.InvokableTool, error) {
	s.logger.Debug("loadWorkspaceTools called", "workspaceID", workspaceID, "conversationID", conversationID, "hasToolLoader", s.toolLoader != nil)

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

	s.logger.Debug("Got workspace for tool loading",
		"workspaceID", workspaceID,
		"workspaceName", workspace.Name,
		"toolsCount", len(workspace.Tools))

	if len(workspace.Tools) == 0 {
		s.logger.Warn("Workspace has no tools configured", "workspaceID", workspaceID)
		return nil, nil
	}

	tools, err := s.toolLoader.LoadWorkspaceTools(ctx, workspaceID, conversationID, workspace.Tools)
	if err != nil {
		s.logger.Error("toolLoader.LoadWorkspaceTools failed", "error", err)
		return nil, err
	}

	s.logger.Debug("Workspace tools loaded", "workspaceID", workspaceID, "toolCount", len(tools))
	return tools, nil
}

// formatAgentError converts agent errors to user-friendly messages
func (s *ChatService) formatAgentError(err error) string {
	errStr := err.Error()

	var msg string
	// Check for common error patterns and provide friendly messages
	switch {
	case strings.Contains(errStr, "exceeds max iterations"):
		msg = "The assistant reached the maximum number of tool call iterations. You can type \"continue\" to resume execution, or try breaking down your request into smaller steps."

	case strings.Contains(errStr, "context canceled"):
		msg = "The request was cancelled."

	case strings.Contains(errStr, "context deadline exceeded"):
		msg = "The request timed out. Please try again or simplify your request."

	case strings.Contains(errStr, "rate limit"):
		msg = "Rate limit exceeded. Please wait a moment and try again."

	case strings.Contains(errStr, "insufficient_quota"):
		msg = "API quota exceeded. Please check your API key balance."

	case strings.Contains(errStr, "invalid_api_key"):
		msg = "Invalid API key. Please check your API key configuration."

	case strings.Contains(errStr, "model not found"):
		msg = "The selected model is not available. Please choose a different model."

	case strings.Contains(errStr, "connection refused") || strings.Contains(errStr, "no such host"):
		msg = "Failed to connect to the AI service. Please check your network connection."

	case strings.Contains(errStr, "tool") && strings.Contains(errStr, "failed"):
		// Extract tool name if possible
		msg = "A tool execution failed: " + extractToolError(errStr)

	default:
		// For unknown errors, show a simplified version
		msg = "An error occurred: " + simplifyErrorMessage(errStr)
	}

	// Format as markdown blockquote for consistent rendering
	return "> ⚠️ **Error**\n>\n> " + msg
}

// extractToolError extracts a more readable error from tool failures
func extractToolError(errStr string) string {
	// Remove node path information first
	if idx := strings.Index(errStr, "\n------------------------"); idx != -1 {
		errStr = errStr[:idx]
	}

	// Try to find the actual error message after common prefixes
	if idx := strings.LastIndex(errStr, "err="); idx != -1 {
		return errStr[idx+4:]
	}

	// Remove [NodeRunError] and other verbose prefixes
	errStr = strings.ReplaceAll(errStr, "[NodeRunError] ", "")
	errStr = strings.ReplaceAll(errStr, "[LocalFunc] ", "")
	errStr = strings.ReplaceAll(errStr, "agent error: ", "")

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
func (s *ChatService) getSystemPrompt(workspaceID string, conversationID string) string {
	basePrompt := `You are a helpful AI assistant working in a development workspace.

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
6. Browser automation for web tasks

When using tools:
- Use appropriate tools to help complete user requests
- For file operations, use the file tools
- For command execution, use the exec tools
- For browser operations, use browser tools with the correct browser_id
- Always verify results before reporting success

Be professional, helpful, and concise in your responses.`

	// Add workspace info context
	workspaceContext := s.getWorkspaceInfoContext(workspaceID)
	if workspaceContext != "" {
		basePrompt += "\n\n" + workspaceContext
	}

	// Add workspace asset context
	assetContext := s.getWorkspaceAssetContext(workspaceID)
	if assetContext != "" {
		basePrompt += "\n\n" + assetContext
	}

	// Add browser context if there are active browsers
	//browserContext := s.getBrowserContext(conversationID)
	//if browserContext != "" {
	//	basePrompt += "\n\n" + browserContext
	//}

	return basePrompt
}

// getWorkspaceInfoContext returns the workspace basic information
func (s *ChatService) getWorkspaceInfoContext(workspaceID string) string {
	if s.workspaceService == nil || workspaceID == "" {
		return ""
	}

	workspace, err := s.workspaceService.GetWorkspace(workspaceID)
	if err != nil || workspace == nil {
		return ""
	}

	var sb strings.Builder
	sb.WriteString("=== CURRENT WORKSPACE ===\n")
	sb.WriteString(fmt.Sprintf("workspace_id: %s\n", workspace.ID))
	sb.WriteString(fmt.Sprintf("name: %s\n", workspace.Name))

	if workspace.Description != "" {
		sb.WriteString(fmt.Sprintf("description: %s\n", workspace.Description))
	}

	sb.WriteString(fmt.Sprintf("status: %s\n", workspace.Status))

	// Add runtime information
	if workspace.Runtime != nil {
		sb.WriteString(fmt.Sprintf("runtime_type: %s\n", workspace.Runtime.Type))

		if workspace.Runtime.WorkDirPath != "" {
			sb.WriteString(fmt.Sprintf("working_directory: %s\n", workspace.Runtime.WorkDirPath))
		}

		if workspace.Runtime.WorkDirContainerPath != nil && *workspace.Runtime.WorkDirContainerPath != "" {
			sb.WriteString(fmt.Sprintf("container_working_directory: %s\n", *workspace.Runtime.WorkDirContainerPath))
		}

		if workspace.Runtime.ContainerName != nil && *workspace.Runtime.ContainerName != "" {
			sb.WriteString(fmt.Sprintf("container_name: %s\n", *workspace.Runtime.ContainerName))
		}
	}

	return sb.String()
}

// getWorkspaceAssetContext returns the asset information for the workspace
func (s *ChatService) getWorkspaceAssetContext(workspaceID string) string {
	if s.workspaceService == nil || s.assetService == nil || workspaceID == "" {
		return ""
	}

	workspace, err := s.workspaceService.GetWorkspace(workspaceID)
	if err != nil || workspace == nil {
		return ""
	}

	if len(workspace.Assets) == 0 {
		return ""
	}

	var sb strings.Builder
	sb.WriteString("=== WORKSPACE CONFIGURED ASSETS ===\n")
	sb.WriteString("The following assets are configured for this workspace. You can use these assets to help complete user requests.\n\n")

	for i, assetRef := range workspace.Assets {
		sb.WriteString(fmt.Sprintf("Asset %d:\n", i+1))
		sb.WriteString(fmt.Sprintf("  asset_id: %s\n", assetRef.AssetID))
		sb.WriteString(fmt.Sprintf("  name: %s\n", assetRef.AssetName))
		sb.WriteString(fmt.Sprintf("  type: %s\n", assetRef.AssetType))

		// Add AI hint if provided
		if assetRef.AIHint != nil && *assetRef.AIHint != "" {
			sb.WriteString(fmt.Sprintf("  hint: %s\n", *assetRef.AIHint))
		}

		// Try to get additional asset details
		if asset, err := s.assetService.GetAsset(assetRef.AssetID); err == nil && asset != nil {
			// Add type-specific information
			switch asset.Type {
			case models.AssetTypeSSH:
				if cfg, ok := asset.Config["host"].(string); ok && cfg != "" {
					sb.WriteString(fmt.Sprintf("  host: %s\n", cfg))
				}
				if port, ok := asset.Config["port"].(float64); ok {
					sb.WriteString(fmt.Sprintf("  port: %d\n", int(port)))
				}
				if user, ok := asset.Config["username"].(string); ok && user != "" {
					sb.WriteString(fmt.Sprintf("  username: %s\n", user))
				}
			case models.AssetTypeDockerHost:
				if connType, ok := asset.Config["connection_type"].(string); ok {
					sb.WriteString(fmt.Sprintf("  connection_type: %s\n", connType))
				}
			case models.AssetTypeLocal:
				if shell, ok := asset.Config["shell"].(string); ok && shell != "" {
					sb.WriteString(fmt.Sprintf("  shell: %s\n", shell))
				}
				if workDir, ok := asset.Config["working_dir"].(string); ok && workDir != "" {
					sb.WriteString(fmt.Sprintf("  working_dir: %s\n", workDir))
				}
			}

			if asset.Description != "" {
				sb.WriteString(fmt.Sprintf("  description: %s\n", asset.Description))
			}
		}
		sb.WriteString("\n")
	}

	return sb.String()
}

// getBrowserContext returns the current browser status for the conversation
func (s *ChatService) getBrowserContext(conversationID string) string {
	if s.browserService == nil || conversationID == "" {
		return ""
	}

	browsers := s.browserService.ListBrowsers(conversationID)
	if len(browsers) == 0 {
		return ""
	}

	var sb strings.Builder
	sb.WriteString("=== ACTIVE BROWSER INSTANCES ===\n")
	sb.WriteString("IMPORTANT: Use these browser_id values for browser operations. Do NOT use old or cached browser_id values.\n\n")

	for i, b := range browsers {
		sb.WriteString(fmt.Sprintf("Browser %d:\n", i+1))
		sb.WriteString(fmt.Sprintf("  browser_id: %s\n", b.ID))
		sb.WriteString(fmt.Sprintf("  status: %s\n", b.Status))
		if b.CurrentURL != "" {
			sb.WriteString(fmt.Sprintf("  current_url: %s\n", b.CurrentURL))
		}
		if b.CurrentTitle != "" {
			sb.WriteString(fmt.Sprintf("  current_title: %s\n", b.CurrentTitle))
		}
		if b.ErrorMessage != "" {
			sb.WriteString(fmt.Sprintf("  error: %s\n", b.ErrorMessage))
		}
	}

	return sb.String()
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
	s.logger.Debug("runStreamingAgent started",
		"workspaceID", req.WorkspaceID,
		"conversationID", conv.ID,
		"modelID", req.Model)

	// Load workspace tools
	workspaceTools, err := s.loadWorkspaceTools(ctx, req.WorkspaceID, conv.ID)
	if err != nil {
		s.logger.Warn("Failed to load workspace tools", "error", err)
	}

	s.logger.Debug("After loadWorkspaceTools",
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
	systemPrompt := s.getSystemPrompt(req.WorkspaceID, conv.ID)

	// Create agent with tools
	agent, err := adk.NewChatModelAgent(ctx, &adk.ChatModelAgentConfig{
		Name:          "Workspace Assistant",
		Description:   "An AI assistant that helps with coding and development tasks in the workspace",
		Instruction:   systemPrompt,
		Model:         chatModel,
		ToolsConfig:   adk.ToolsConfig{ToolsNodeConfig: compose.ToolsNodeConfig{Tools: baseTools}},
		MaxIterations: 50,
	})
	if err != nil {
		return assistantMsg, fmt.Errorf("failed to create agent: %w", err)
	}

	// Helper to send chunk and update buffer
	sendChunk := func(chunk *models.ChatCompletionChunk) {
		s.updateStreamBuffer(conv.ID, chunk)
		chunks <- chunk
	}

	// Send initial chunk with role
	sendChunk(&models.ChatCompletionChunk{
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
	})

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

			s.logger.Debug("Received tool result", "toolCallID", fullMsg.ToolCallID, "toolName", fullMsg.ToolName)

			// Get current round index from the assistant message
			roundIndex := currentAssistantMsg.GetMaxRoundIndex()

			// Add tool result to current assistant message's parts
			currentAssistantMsg.AddToolResultPart(fullMsg.ToolCallID, fullMsg.ToolName, fullMsg.Content, roundIndex)
			s.SaveMessage(currentAssistantMsg)

			// Send tool result chunk to frontend
			sendChunk(&models.ChatCompletionChunk{
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
			})

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
						sendChunk(&models.ChatCompletionChunk{
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
						})
					}
					if chunk.ReasoningContent != "" {
						sendChunk(&models.ChatCompletionChunk{
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
						})
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
					sendChunk(&models.ChatCompletionChunk{
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
					})
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
	sendChunk(&models.ChatCompletionChunk{
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
	})

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
