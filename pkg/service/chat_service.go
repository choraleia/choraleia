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
	"github.com/cloudwego/eino/adk/prebuilt/deep"
	"github.com/cloudwego/eino/adk/prebuilt/planexecute"
	"github.com/cloudwego/eino/adk/prebuilt/supervisor"
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
	ErrAgentNotFound        = errors.New("agent not found")
)

// ToolLoader interface for loading tools (implemented by tools package)
type ToolLoader interface {
	LoadWorkspaceTools(ctx context.Context, workspaceID string, conversationID string, toolConfigs []models.WorkspaceTool) ([]tool.InvokableTool, error)
}

// ChatService handles workspace chat operations
type ChatService struct {
	db                      *gorm.DB
	modelService            *ModelService
	workspaceService        *WorkspaceService
	assetService            *AssetService
	toolLoader              ToolLoader
	browserService          *BrowserService
	memoryService           *MemoryService
	compressionService      *CompressionService
	compressionConfig       *CompressionConfig
	memoryExtractionService *MemoryExtractionService
	memoryExtractionConfig  *MemoryExtractionConfig
	logger                  *slog.Logger

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

// SetMemoryService sets the memory service for memory context injection
func (s *ChatService) SetMemoryService(memoryService *MemoryService) {
	s.memoryService = memoryService
	// Initialize compression service when memory service is available
	if s.compressionConfig == nil {
		s.compressionConfig = DefaultCompressionConfig()
	}
	s.compressionService = NewCompressionService(s.db, s.modelService, memoryService, s.compressionConfig)

	// Initialize memory extraction service
	if s.memoryExtractionConfig == nil {
		s.memoryExtractionConfig = DefaultMemoryExtractionConfig()
	}
	s.memoryExtractionService = NewMemoryExtractionService(s.db, s.modelService, memoryService, s.memoryExtractionConfig)
}

// SetMemoryExtractionConfig sets the memory extraction configuration
func (s *ChatService) SetMemoryExtractionConfig(config *MemoryExtractionConfig) {
	s.memoryExtractionConfig = config
	if s.memoryService != nil {
		s.memoryExtractionService = NewMemoryExtractionService(s.db, s.modelService, s.memoryService, config)
	}
}

// GetMemoryExtractionService returns the memory extraction service
func (s *ChatService) GetMemoryExtractionService() *MemoryExtractionService {
	return s.memoryExtractionService
}

// SetCompressionConfig sets the compression configuration
func (s *ChatService) SetCompressionConfig(config *CompressionConfig) {
	s.compressionConfig = config
	if s.memoryService != nil {
		s.compressionService = NewCompressionService(s.db, s.modelService, s.memoryService, config)
	}
}

// GetCompressionService returns the compression service
func (s *ChatService) GetCompressionService() *CompressionService {
	return s.compressionService
}

// SetAssetService sets the asset service for asset info lookup
func (s *ChatService) SetAssetService(assetService *AssetService) {
	s.assetService = assetService
}

// AutoMigrate creates database tables
func (s *ChatService) AutoMigrate() error {
	if err := s.db.AutoMigrate(&models.Conversation{}, &models.Message{}); err != nil {
		return err
	}
	// Migrate message chunks table for real-time persistence
	if err := s.db.AutoMigrate(&db.MessageChunk{}); err != nil {
		return err
	}
	// Migrate compression tables
	if err := s.db.AutoMigrate(&db.ConversationSnapshot{}); err != nil {
		return err
	}
	// Clean up stale streaming states on startup
	s.CleanupStaleStreams()
	return nil
}

// CleanupStaleStreams marks any messages with streaming/running status as interrupted
// This should be called on service startup to handle cases where the service was restarted
// while messages were still being streamed
func (s *ChatService) CleanupStaleStreams() {
	result := s.db.Model(&models.Message{}).
		Where("status IN ?", []string{
			string(models.MessageStatusStreaming),
			string(models.MessageStatusPending),
		}).
		Updates(map[string]interface{}{
			"status":        models.MessageStatusCompleted,
			"finish_reason": models.FinishReasonInterrupted,
		})

	if result.Error != nil {
		s.logger.Error("Failed to cleanup stale streams", "error", result.Error)
	} else if result.RowsAffected > 0 {
		s.logger.Info("Cleaned up stale streaming messages on startup", "count", result.RowsAffected)
	}
}

// ========== MessageChunk Management ==========

// LoadMessagesWithChunks loads chunks for multiple messages in a single query
// Returns a map of messageID -> []MessageChunk
func (s *ChatService) LoadMessagesWithChunks(messageIDs []string) (map[string][]db.MessageChunk, error) {
	if len(messageIDs) == 0 {
		return make(map[string][]db.MessageChunk), nil
	}

	var allChunks []db.MessageChunk
	if err := s.db.Where("message_id IN ?", messageIDs).
		Order("message_id ASC, round_index ASC, seq_index ASC, created_at ASC").
		Find(&allChunks).Error; err != nil {
		return nil, err
	}

	// Group chunks by message ID
	result := make(map[string][]db.MessageChunk)
	for _, chunk := range allChunks {
		result[chunk.MessageID] = append(result[chunk.MessageID], chunk)
	}

	return result, nil
}

// LoadMessageWithChunks loads a message and its chunks from the database
func (s *ChatService) LoadMessageWithChunks(messageID string) (*models.Message, error) {
	var msg models.Message
	if err := s.db.First(&msg, "id = ?", messageID).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrMessageNotFound
		}
		return nil, err
	}

	var chunks []db.MessageChunk
	if err := s.db.Where("message_id = ?", messageID).
		Order("round_index ASC, seq_index ASC, created_at ASC").
		Find(&chunks).Error; err != nil {
		return nil, err
	}

	msg.Chunks = chunks
	return &msg, nil
}

// AddAndSaveTextChunk adds a text chunk to message and saves to database in real-time
func (s *ChatService) AddAndSaveTextChunk(msg *models.Message, text string, roundIndex int, agentName string) error {
	// Get sequence index (count of existing chunks in this round)
	seqIndex := s.getNextSeqIndex(msg, roundIndex)

	chunk := db.MessageChunk{
		ID:         uuid.New().String(),
		MessageID:  msg.ID,
		Type:       db.ChunkTypeText,
		RoundIndex: roundIndex,
		SeqIndex:   seqIndex,
		AgentName:  agentName,
		Text:       text,
		CreatedAt:  time.Now(),
	}

	// Add to in-memory message
	msg.Chunks = append(msg.Chunks, chunk)

	// Save to database
	return s.db.Create(&chunk).Error
}

// AddAndSaveReasoningChunk adds a reasoning chunk to message and saves to database in real-time
func (s *ChatService) AddAndSaveReasoningChunk(msg *models.Message, text string, roundIndex int, agentName string) error {
	seqIndex := s.getNextSeqIndex(msg, roundIndex)

	chunk := db.MessageChunk{
		ID:         uuid.New().String(),
		MessageID:  msg.ID,
		Type:       db.ChunkTypeReasoning,
		RoundIndex: roundIndex,
		SeqIndex:   seqIndex,
		AgentName:  agentName,
		Text:       text,
		CreatedAt:  time.Now(),
	}

	msg.Chunks = append(msg.Chunks, chunk)
	return s.db.Create(&chunk).Error
}

// AddAndSaveToolCallChunk adds a tool call chunk to message and saves to database in real-time
func (s *ChatService) AddAndSaveToolCallChunk(msg *models.Message, toolCallID, toolName, args string, roundIndex int, agentName string) error {
	seqIndex := s.getNextSeqIndex(msg, roundIndex)

	chunk := db.MessageChunk{
		ID:         uuid.New().String(),
		MessageID:  msg.ID,
		Type:       db.ChunkTypeToolCall,
		RoundIndex: roundIndex,
		SeqIndex:   seqIndex,
		AgentName:  agentName,
		ToolCallID: toolCallID,
		ToolName:   toolName,
		ToolArgs:   args,
		CreatedAt:  time.Now(),
	}

	msg.Chunks = append(msg.Chunks, chunk)
	return s.db.Create(&chunk).Error
}

// AddAndSaveToolResultChunk adds a tool result chunk to message and saves to database in real-time
func (s *ChatService) AddAndSaveToolResultChunk(msg *models.Message, toolCallID, toolName, content string, roundIndex int, agentName string) error {
	seqIndex := s.getNextSeqIndex(msg, roundIndex)

	chunk := db.MessageChunk{
		ID:                uuid.New().String(),
		MessageID:         msg.ID,
		Type:              db.ChunkTypeToolResult,
		RoundIndex:        roundIndex,
		SeqIndex:          seqIndex,
		AgentName:         agentName,
		ToolCallID:        toolCallID,
		ToolName:          toolName,
		ToolResultContent: content,
		CreatedAt:         time.Now(),
	}

	msg.Chunks = append(msg.Chunks, chunk)
	return s.db.Create(&chunk).Error
}

// getNextSeqIndex returns the next sequence index for a given round
func (s *ChatService) getNextSeqIndex(msg *models.Message, roundIndex int) int {
	count := 0
	for _, chunk := range msg.Chunks {
		if chunk.RoundIndex == roundIndex {
			count++
		}
	}
	return count
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

// chunksToMessageParts converts database chunks to message parts (merged format)
func (s *ChatService) chunksToMessageParts(chunks []db.MessageChunk) []db.MessagePart {
	if len(chunks) == 0 {
		return nil
	}

	var parts []db.MessagePart
	n := len(chunks)
	i := 0

	for i < n {
		chunk := chunks[i]

		switch chunk.Type {
		case db.ChunkTypeText:
			// Merge consecutive text chunks
			var textBuilder strings.Builder
			roundIndex := chunk.RoundIndex
			for i < n && chunks[i].Type == db.ChunkTypeText {
				if chunks[i].Text != "" {
					if textBuilder.Len() > 0 {
						textBuilder.WriteString("")
					}
					textBuilder.WriteString(chunks[i].Text)
				}
				i++
			}
			if textBuilder.Len() > 0 {
				parts = append(parts, db.MessagePart{
					Type:  "text",
					Index: roundIndex,
					Text:  textBuilder.String(),
				})
			}

		case db.ChunkTypeReasoning:
			// Merge consecutive reasoning chunks
			var reasoningBuilder strings.Builder
			roundIndex := chunk.RoundIndex
			for i < n && chunks[i].Type == db.ChunkTypeReasoning {
				if chunks[i].Text != "" {
					if reasoningBuilder.Len() > 0 {
						reasoningBuilder.WriteString("")
					}
					reasoningBuilder.WriteString(chunks[i].Text)
				}
				i++
			}
			if reasoningBuilder.Len() > 0 {
				parts = append(parts, db.MessagePart{
					Type:  "reasoning",
					Index: roundIndex,
					Text:  reasoningBuilder.String(),
				})
			}

		case db.ChunkTypeToolCall:
			parts = append(parts, db.MessagePart{
				Type:  "tool_call",
				Index: chunk.RoundIndex,
				ToolCall: &db.ToolCallPart{
					ID:        chunk.ToolCallID,
					Name:      chunk.ToolName,
					Arguments: chunk.ToolArgs,
				},
			})
			i++

		case db.ChunkTypeToolResult:
			parts = append(parts, db.MessagePart{
				Type:  "tool_result",
				Index: chunk.RoundIndex,
				ToolResult: &db.ToolResultPart{
					ToolCallID: chunk.ToolCallID,
					Name:       chunk.ToolName,
					Content:    chunk.ToolResultContent,
				},
			})
			i++

		case db.ChunkTypeImageURL:
			parts = append(parts, db.MessagePart{
				Type:  "image_url",
				Index: chunk.RoundIndex,
				ImageURL: &db.ImageURLPart{
					URL:    chunk.MediaURL,
					Detail: chunk.MediaDetail,
				},
			})
			i++

		case db.ChunkTypeAudioURL:
			parts = append(parts, db.MessagePart{
				Type:  "audio_url",
				Index: chunk.RoundIndex,
				AudioURL: &db.AudioURLPart{
					URL:      chunk.MediaURL,
					MimeType: chunk.MediaMimeType,
					Duration: chunk.MediaDuration,
				},
			})
			i++

		case db.ChunkTypeVideoURL:
			parts = append(parts, db.MessagePart{
				Type:  "video_url",
				Index: chunk.RoundIndex,
				VideoURL: &db.VideoURLPart{
					URL:      chunk.MediaURL,
					MimeType: chunk.MediaMimeType,
					Duration: chunk.MediaDuration,
				},
			})
			i++

		case db.ChunkTypeFileURL:
			parts = append(parts, db.MessagePart{
				Type:  "file_url",
				Index: chunk.RoundIndex,
				FileURL: &db.FileURLPart{
					URL:      chunk.MediaURL,
					MimeType: chunk.MediaMimeType,
					Name:     chunk.MediaName,
					Size:     chunk.MediaSize,
				},
			})
			i++

		default:
			i++
		}
	}

	return parts
}

// GetMessages retrieves all messages for a conversation with their chunks and parts
func (s *ChatService) GetMessages(conversationID string) ([]models.Message, error) {
	var messages []models.Message

	if err := s.db.Where("conversation_id = ?", conversationID).
		Order("created_at ASC").
		Find(&messages).Error; err != nil {
		return nil, err
	}

	// Collect message IDs for batch loading
	messageIDs := make([]string, len(messages))
	for i, msg := range messages {
		messageIDs[i] = msg.ID
	}

	// Batch load all chunks in a single query
	chunksMap, err := s.LoadMessagesWithChunks(messageIDs)
	if err != nil {
		s.logger.Warn("Failed to batch load chunks", "error", err)
	} else {
		for i := range messages {
			messages[i].Chunks = chunksMap[messages[i].ID]
			// Convert chunks to parts for API response
			messages[i].Parts = s.chunksToMessageParts(messages[i].Chunks)
		}
	}

	return messages, nil
}

// MessageWithCompression represents a message with compression metadata
type MessageWithCompression struct {
	models.Message
	CompressionInfo *CompressionInfo `json:"compression_info,omitempty"`
}

// CompressionInfo contains compression-related metadata for a message
type CompressionInfo struct {
	IsCompressed bool   `json:"is_compressed"`
	SnapshotID   string `json:"snapshot_id,omitempty"`
}

// GetMessagesWithCompressionInfo retrieves all messages with compression metadata
// This is used by frontend to display full history with compression indicators
func (s *ChatService) GetMessagesWithCompressionInfo(conversationID string) ([]MessageWithCompression, error) {
	messages, err := s.GetMessages(conversationID)
	if err != nil {
		return nil, err
	}

	result := make([]MessageWithCompression, len(messages))
	for i, msg := range messages {
		result[i] = MessageWithCompression{
			Message: msg,
		}
		if msg.IsCompressed {
			snapshotID := ""
			if msg.SnapshotID != nil {
				snapshotID = *msg.SnapshotID
			}
			result[i].CompressionInfo = &CompressionInfo{
				IsCompressed: true,
				SnapshotID:   snapshotID,
			}
		}
	}

	return result, nil
}

// GetMessage retrieves a single message with its chunks
func (s *ChatService) GetMessage(id string) (*models.Message, error) {
	return s.LoadMessageWithChunks(id)
}

// SaveMessage saves a message and its chunks to the database
func (s *ChatService) SaveMessage(msg *models.Message) error {
	if msg.ID == "" {
		msg.ID = uuid.New().String()
	}

	// Save the message first
	if err := s.db.Save(msg).Error; err != nil {
		return err
	}

	// Save chunks if present (chunks have gorm:"-" so they won't be saved automatically)
	if len(msg.Chunks) > 0 {
		for i := range msg.Chunks {
			if msg.Chunks[i].ID == "" {
				msg.Chunks[i].ID = uuid.New().String()
			}
			msg.Chunks[i].MessageID = msg.ID
			if msg.Chunks[i].CreatedAt.IsZero() {
				msg.Chunks[i].CreatedAt = time.Now()
			}
		}
		if err := s.db.Save(&msg.Chunks).Error; err != nil {
			return err
		}
	}

	return nil
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
	//tools, err := s.toolLoader.LoadWorkspaceTools(ctx, workspaceID, conversationID, nil)
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
		return nil, ErrModelNotConfigured
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

	// Check if there's an existing session and wait for it to complete
	if existingSession, ok := s.activeStreams.Load(conv.ID); ok {
		oldSess := existingSession.(*StreamSession)
		// Cancel the old session if still running
		oldSess.Cancel()
		// Wait for old session to complete (with timeout)
		select {
		case <-oldSess.done:
			// Old session completed
		case <-time.After(5 * time.Second):
			// Timeout - proceed anyway
			s.logger.Warn("Timeout waiting for old session to complete", "conversationID", conv.ID)
		}
		// Remove old session
		s.activeStreams.Delete(conv.ID)
	}

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

			// Check if this is a cancellation
			if errors.Is(err, context.Canceled) {
				// Ensure message status is updated (in case runStreamingAgent didn't save)
				if targetMsg.Status != models.MessageStatusCompleted {
					targetMsg.Status = models.MessageStatusCompleted
					targetMsg.FinishReason = models.FinishReasonCancelled
					s.SaveMessage(targetMsg)
				}

				// Send finish chunk with cancelled reason
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
							FinishReason: models.FinishReasonCancelled,
						},
					},
				}
				s.updateStreamBuffer(conv.ID, finishChunk)
				chunks <- finishChunk
			} else {
				// Convert error to user-friendly message
				errorMsg := s.formatAgentError(err)

				// Append error to existing content using Chunks
				existingText := targetMsg.GetTextContent()
				if existingText != "" {
					targetMsg.AddTextChunk(errorMsg, targetMsg.GetMaxRoundIndex())
				} else {
					targetMsg.AddTextChunk(errorMsg, 0)
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
		// Convert content to Chunks
		var chunks []models.MessageChunk
		if content, ok := userMsg.Content.(string); ok && content != "" {
			chunks = append(chunks, models.MessageChunk{
				Type: models.ChunkTypeText,
				Text: content,
			})
		}

		userMsgModel := &models.Message{
			ID:             uuid.New().String(),
			ConversationID: conv.ID,
			Role:           models.RoleUser,
			Chunks:         chunks,
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

	// Convert content to Chunks
	var chunks []models.MessageChunk
	if newContent != "" {
		chunks = append(chunks, models.MessageChunk{
			Type: models.ChunkTypeText,
			Text: newContent,
		})
	}

	newUserMsg := &models.Message{
		ID:     uuid.New().String(),
		Role:   models.RoleUser,
		Chunks: chunks,
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
		// Just cancel the context - the goroutine will handle cleanup and send finish chunk
		sess.Cancel()
		// Don't delete activeStreams here - let the goroutine clean up after sending finish chunk
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
		Title:       "New Chat",
	})
}

func (s *ChatService) saveUserMessage(conversationID string, msg *models.ChatCompletionMessage) error {
	// Convert content to Chunks
	var chunks []models.MessageChunk
	if content, ok := msg.Content.(string); ok && content != "" {
		chunks = append(chunks, models.MessageChunk{
			Type: models.ChunkTypeText,
			Text: content,
		})
	}

	userMsg := &models.Message{
		ID:             uuid.New().String(),
		ConversationID: conversationID,
		Role:           models.RoleUser,
		Chunks:         chunks,
		Name:           msg.Name,
		Status:         models.MessageStatusCompleted,
	}
	return s.SaveMessage(userMsg)
}

func (s *ChatService) buildConversationHistory(conversationID string) ([]*schema.Message, error) {
	messages, err := s.GetUncompressedMessages(conversationID)
	if err != nil {
		return nil, err
	}

	history := make([]*schema.Message, 0)

	// Convert messages to schema messages
	for _, msg := range messages {
		// Convert each message to schema messages (may produce multiple for tool calls)
		schemaMessages := s.messageToSchemaMessages(&msg)
		history = append(history, schemaMessages...)
	}

	return history, nil
}

// GetUncompressedMessages retrieves non-compressed messages for a conversation with their chunks
func (s *ChatService) GetUncompressedMessages(conversationID string) ([]models.Message, error) {
	var messages []models.Message

	if err := s.db.Where("conversation_id = ? AND is_compressed = ?", conversationID, false).
		Order("created_at ASC").
		Find(&messages).Error; err != nil {
		return nil, err
	}

	// Collect message IDs for batch loading
	messageIDs := make([]string, len(messages))
	for i, msg := range messages {
		messageIDs[i] = msg.ID
	}

	// Batch load all chunks in a single query
	chunksMap, err := s.LoadMessagesWithChunks(messageIDs)
	if err != nil {
		s.logger.Warn("Failed to batch load chunks", "error", err)
	} else {
		for i := range messages {
			messages[i].Chunks = chunksMap[messages[i].ID]
		}
	}

	return messages, nil
}

// estimateMessagesTokens estimates token count for messages
func (s *ChatService) estimateMessagesTokens(messages []models.Message) int {
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

// messageToSchemaMessages converts a db.Message with Chunks to one or more schema.Message
func (s *ChatService) messageToSchemaMessages(msg *models.Message) []*schema.Message {
	if msg.Chunks == nil || len(msg.Chunks) == 0 {
		return []*schema.Message{}
	}

	// For user messages - simple text concatenation
	if msg.Role == db.RoleUser {
		var content string
		for _, chunk := range msg.Chunks {
			if chunk.Type == db.ChunkTypeText && chunk.Text != "" {
				if content != "" {
					content += "\n"
				}
				content += chunk.Text
			}
		}
		return []*schema.Message{{
			Role:    schema.RoleType(msg.Role),
			Content: content,
			Name:    msg.Name,
		}}
	}

	// For assistant messages
	result := make([]*schema.Message, 0)
	chunks := msg.Chunks
	n := len(chunks)

	// Track tool_calls that have been added and tool_results that exist
	toolCallsAdded := make(map[string]string) // tool_call_id -> tool_name
	toolResultsExist := make(map[string]bool) // tool_call_id -> true

	// First pass: collect all tool_result ids
	for _, chunk := range chunks {
		if chunk.Type == db.ChunkTypeToolResult && chunk.ToolName != "transfer_to_agent" {
			toolResultsExist[chunk.ToolCallID] = true
		}
	}

	// Second pass: process chunks
	i := 0
	for i < n {
		chunk := chunks[i]

		switch chunk.Type {
		case db.ChunkTypeText:
			// Merge consecutive text chunks
			var content string
			for i < n && chunks[i].Type == db.ChunkTypeText {
				if chunks[i].Text != "" {
					if content != "" {
						content += "\n"
					}
					content += chunks[i].Text
				}
				i++
			}
			if content != "" {
				result = append(result, &schema.Message{
					Role:             schema.Assistant,
					Content:          content,
					ReasoningContent: " ",
				})
			}

		case db.ChunkTypeReasoning:
			// Merge consecutive reasoning chunks
			var reasoning string
			for i < n && chunks[i].Type == db.ChunkTypeReasoning {
				if chunks[i].Text != "" {
					if reasoning != "" {
						reasoning += "\n"
					}
					reasoning += chunks[i].Text
				}
				i++
			}
			if reasoning != "" {
				result = append(result, &schema.Message{
					Role:             schema.Assistant,
					ReasoningContent: reasoning,
				})
			}

		case db.ChunkTypeToolCall:
			// Skip transfer_to_agent
			if chunk.ToolName == "transfer_to_agent" {
				i++
				continue
			}
			// Each tool_call is a separate assistant message
			result = append(result, &schema.Message{
				Role:             schema.Assistant,
				ReasoningContent: " ",
				ToolCalls: []schema.ToolCall{{
					ID:   chunk.ToolCallID,
					Type: "function",
					Function: schema.FunctionCall{
						Name:      chunk.ToolName,
						Arguments: chunk.ToolArgs,
					},
				}},
			})
			toolCallsAdded[chunk.ToolCallID] = chunk.ToolName
			i++

		case db.ChunkTypeToolResult:
			// Skip transfer_to_agent
			if chunk.ToolName == "transfer_to_agent" {
				i++
				continue
			}
			// Each tool_result is a separate tool message
			result = append(result, &schema.Message{
				Role:       schema.Tool,
				ToolCallID: chunk.ToolCallID,
				ToolName:   chunk.ToolName,
				Content:    chunk.ToolResultContent,
			})
			i++

		default:
			i++
		}
	}

	// Final check: append empty tool_result for any tool_call without result
	for toolCallID, toolName := range toolCallsAdded {
		if !toolResultsExist[toolCallID] {
			result = append(result, &schema.Message{
				Role:       schema.Tool,
				ToolCallID: toolCallID,
				ToolName:   toolName,
				Content:    "",
			})
		}
	}

	return result
}

func (s *ChatService) loadWorkspaceTools(ctx context.Context, workspaceID string, conversationID string) ([]tool.InvokableTool, error) {
	if workspaceID == "" || s.toolLoader == nil {
		return nil, nil
	}

	workspace, err := s.workspaceService.Get(ctx, workspaceID)
	if err != nil {
		s.logger.Error("Failed to get workspace", "workspaceID", workspaceID, "error", err)
		return nil, err
	}

	if len(workspace.Tools) == 0 {
		return nil, nil
	}

	tools, err := s.toolLoader.LoadWorkspaceTools(ctx, workspaceID, conversationID, workspace.Tools)
	if err != nil {
		s.logger.Error("toolLoader.LoadWorkspaceTools failed", "error", err)
		return nil, err
	}

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

// createCompressionMiddlewares creates context reduction middlewares to prevent context length errors
// Uses compression service to compress old messages instead of just clearing tool results
// Threshold is calculated as 75% of the model's context window size
// rootAgentName: only the root agent triggers compression to avoid duplicate compression in multi-agent scenarios
func (s *ChatService) createCompressionMiddlewares(conversationID string, workspaceID string, rootAgentName string) []adk.AgentMiddleware {
	var middlewares []adk.AgentMiddleware

	// Create a middleware that checks context size and triggers compression if needed
	if s.compressionService != nil && s.workspaceService != nil {
		// Get compression model from workspace config
		var compressionModelID string
		var contextWindow int

		workspace, err := s.workspaceService.GetWorkspace(workspaceID)
		if err != nil {
			s.logger.Warn("Failed to get workspace for compression config", "error", err)
			return middlewares
		}

		if workspace.CompressionModel != nil && *workspace.CompressionModel != "" {
			compressionModelID = *workspace.CompressionModel
			// Get model's context window size
			if modelConfig, err := s.modelService.GetModelConfig(compressionModelID); err == nil && modelConfig != nil {
				if modelConfig.Limits != nil && modelConfig.Limits.ContextWindow > 0 {
					contextWindow = modelConfig.Limits.ContextWindow
				}
			}
		}

		// Use default if model doesn't specify context window
		if contextWindow <= 0 {
			contextWindow = 128000 // Default fallback
		}

		// Calculate threshold as 75% of context window
		threshold := int(float64(contextWindow) * 0.75)

		compressionMiddleware := adk.AgentMiddleware{
			BeforeChatModel: func(ctx context.Context, state *adk.ChatModelAgentState) error {
				// Estimate current context size from state.Messages
				totalTokens := 0
				for _, msg := range state.Messages {
					totalTokens += len(msg.Content) / 4
					totalTokens += len(msg.ReasoningContent) / 4
					for _, tc := range msg.ToolCalls {
						totalTokens += len(tc.Function.Arguments) / 4
					}
					totalTokens += 10 // overhead
				}

				// If within limit, no action needed
				if totalTokens <= threshold {
					return nil
				}

				s.logger.Info("Context approaching limit, triggering compression",
					"conversationID", conversationID,
					"estimatedTokens", totalTokens,
					"threshold", threshold,
					"contextWindow", contextWindow)

				// Find the index where runtime messages start (messages not yet in database)
				// These are typically recent tool calls and results that need to be preserved
				dbHistory, err := s.buildConversationHistory(conversationID)
				if err != nil {
					s.logger.Warn("Failed to load conversation history for comparison", "error", err)
					// Continue without updating state.Messages
					return nil
				}

				// Identify runtime messages (messages in state but not in database)
				// These are messages generated during the current agent run
				runtimeStartIdx := len(dbHistory)
				if runtimeStartIdx > len(state.Messages) {
					runtimeStartIdx = len(state.Messages)
				}

				// Perform compression on database messages
				maxCompressionRounds := 5
				compressed := false
				for round := 0; round < maxCompressionRounds; round++ {
					snapshot, err := s.compressionService.Compress(ctx, conversationID, compressionModelID)
					if err != nil {
						s.logger.Warn("Compression failed", "error", err, "round", round+1)
						break
					}
					if snapshot == nil || snapshot.MessageCount == 0 {
						break
					}

					compressed = true

					// Re-estimate tokens after compression
					totalTokens = totalTokens - snapshot.OriginalTokens + snapshot.CompressedTokens
					if totalTokens <= threshold {
						break
					}
				}

				// If compression happened, rebuild state.Messages
				// Combine compressed database history with runtime messages
				if compressed {
					newHistory, err := s.buildConversationHistory(conversationID)
					if err != nil {
						s.logger.Warn("Failed to rebuild history after compression", "error", err)
						return nil
					}

					// Preserve runtime messages (tool calls/results from current run)
					// These are messages after runtimeStartIdx in the original state
					if runtimeStartIdx < len(state.Messages) {
						runtimeMessages := state.Messages[runtimeStartIdx:]
						newHistory = append(newHistory, runtimeMessages...)
					}

					// Update state.Messages with compressed history + runtime messages
					state.Messages = newHistory
				}

				return nil
			},
		}
		middlewares = append(middlewares, compressionMiddleware)
	}

	return middlewares
}

// createModelRetryConfig creates retry configuration for ChatModel
// It handles transient errors like rate limits and network issues
// For context length errors, it triggers compression before retry
func (s *ChatService) createModelRetryConfig(conversationID string) *adk.ModelRetryConfig {
	return &adk.ModelRetryConfig{
		MaxRetries: 3,
		IsRetryAble: func(ctx context.Context, err error) bool {
			if err == nil {
				return false
			}

			errStr := strings.ToLower(err.Error())

			// Always retry on rate limit errors
			if strings.Contains(errStr, "rate limit") ||
				strings.Contains(errStr, "too many requests") ||
				strings.Contains(errStr, "429") {
				s.logger.Info("Rate limit error, will retry", "error", err)
				return true
			}

			// Retry on temporary network errors
			if strings.Contains(errStr, "connection refused") ||
				strings.Contains(errStr, "timeout") ||
				strings.Contains(errStr, "temporary") {
				s.logger.Info("Temporary network error, will retry", "error", err)
				return true
			}

			// For context length errors, don't retry here
			// Compression is handled in BeforeChatModel middleware
			if IsContextLengthError(err) {
				s.logger.Warn("Context length error, compression should have been handled in BeforeChatModel",
					"conversationID", conversationID,
					"error", err)
				return false
			}

			// Don't retry on other errors (invalid API key, model not found, etc.)
			return false
		},
		BackoffFunc: func(ctx context.Context, attempt int) time.Duration {
			// Exponential backoff: 1s, 2s, 4s, 8s...
			baseDelay := time.Second
			delay := baseDelay * time.Duration(1<<uint(attempt-1))
			maxDelay := 30 * time.Second
			if delay > maxDelay {
				delay = maxDelay
			}
			return delay
		},
	}
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

// getSystemPrompt returns the static system prompt for the workspace
// Returns only static instruction to maximize context cache utilization
// Dynamic context should be injected separately when needed
func (s *ChatService) getSystemPrompt(workspaceID string, conversationID string) string {
	return s.getStaticInstruction()
}

// getStaticInstruction returns the static system instruction that doesn't change
// This content can be cached by LLM providers (context cache)
func (s *ChatService) getStaticInstruction() string {
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
6. Browser automation for web tasks

When using tools:
- Use appropriate tools to help complete user requests
- For file operations, use the file tools
- For command execution, use the exec tools
- For browser operations, use browser tools with the correct browser_id
- Always verify results before reporting success

Be professional, helpful, and concise in your responses.`
}

// Dynamic context markers for identification in message history
const (
	DynamicContextStartMarker = "<<<DYNAMIC_ENV_CONTEXT_START>>>"
	DynamicContextEndMarker   = "<<<DYNAMIC_ENV_CONTEXT_END>>>"
)

// wrapDynamicContext wraps dynamic context with markers for identification
func (s *ChatService) wrapDynamicContext(content string) string {
	if content == "" {
		return ""
	}
	return DynamicContextStartMarker + "\n" + content + "\n" + DynamicContextEndMarker
}

// extractDynamicContext extracts dynamic context from a message content
// Returns the content between markers, or empty string if not found
func (s *ChatService) extractDynamicContext(content string) string {
	startIdx := strings.Index(content, DynamicContextStartMarker)
	if startIdx == -1 {
		return ""
	}
	endIdx := strings.Index(content, DynamicContextEndMarker)
	if endIdx == -1 || endIdx <= startIdx {
		return ""
	}
	// Extract content between markers (excluding the markers and surrounding newlines)
	start := startIdx + len(DynamicContextStartMarker) + 1 // +1 for newline
	end := endIdx - 1                                      // -1 for newline before end marker
	if start >= end {
		return ""
	}
	return content[start:end]
}

// isDynamicContextMessage checks if a message is a dynamic context injection message
func (s *ChatService) isDynamicContextMessage(msg *schema.Message) bool {
	if msg.Role != schema.User {
		return false
	}
	return strings.Contains(msg.Content, DynamicContextStartMarker) &&
		strings.Contains(msg.Content, DynamicContextEndMarker)
}

// getDynamicContext returns dynamic context that may change during conversation
// This should be called sparingly to avoid invalidating context cache
// Use cases: initial conversation, explicit refresh, after significant environment changes
func (s *ChatService) getDynamicContext(workspaceID string, conversationID string) string {
	var parts []string

	// Add workspace info context
	workspaceContext := s.getWorkspaceInfoContext(workspaceID)
	if workspaceContext != "" {
		parts = append(parts, workspaceContext)
	}

	// Add workspace asset context
	assetContext := s.getWorkspaceAssetContext(workspaceID)
	if assetContext != "" {
		parts = append(parts, assetContext)
	}

	// Add memory context (relevant memories for current conversation)
	memoryContext := s.getMemoryContext(workspaceID, conversationID, nil, "")
	if memoryContext != "" {
		parts = append(parts, memoryContext)
	}

	// Add compression summary context if available
	summaryContext := s.getCompressionSummaryContext(conversationID)
	if summaryContext != "" {
		parts = append(parts, summaryContext)
	}

	if len(parts) == 0 {
		return ""
	}
	return strings.Join(parts, "\n\n")
}

// createGenModelInput creates a GenModelInput function that intelligently injects dynamic context
// It scans history for existing dynamic context, compares with current, and injects before last user message if changed
func (s *ChatService) createGenModelInput(workspaceID string, conversationID string) adk.GenModelInput {
	return func(ctx context.Context, instruction string, input *adk.AgentInput) ([]*schema.Message, error) {
		messages := make([]*schema.Message, 0, len(input.Messages)+2)

		// 1. Add static instruction as system message
		if instruction != "" {
			messages = append(messages, &schema.Message{
				Role:    schema.System,
				Content: instruction,
			})
		}

		// 2. Get current dynamic context
		currentDynamicContext := s.getDynamicContext(workspaceID, conversationID)

		// 3. Find the latest dynamic context in history and locate last user message
		var latestDynamicContext string
		var lastUserMsgIdx = -1

		for i, msg := range input.Messages {
			if s.isDynamicContextMessage(msg) {
				// Keep tracking the latest one
				latestDynamicContext = s.extractDynamicContext(msg.Content)
			}
			if msg.Role == schema.User && !s.isDynamicContextMessage(msg) {
				lastUserMsgIdx = i
			}
		}

		// 4. Determine if we need to inject new dynamic context
		// Only inject if current context is different from the latest one in history
		needsInjection := currentDynamicContext != "" && currentDynamicContext != latestDynamicContext

		// 5. Build final message list (keep all existing messages)
		for i, msg := range input.Messages {

			// Inject new dynamic context before last user message
			if needsInjection && i == lastUserMsgIdx {
				wrappedContext := s.wrapDynamicContext(currentDynamicContext)
				messages = append(messages, &schema.Message{
					Role:    schema.User,
					Content: wrappedContext,
				})
				needsInjection = false // Mark as injected
			}

			messages = append(messages, msg)
		}

		// If we still need to inject (no user message found or it was the last one)
		// This handles edge case where there's no user message yet
		if needsInjection && currentDynamicContext != "" {
			wrappedContext := s.wrapDynamicContext(currentDynamicContext)
			messages = append(messages, &schema.Message{
				Role:    schema.User,
				Content: wrappedContext,
			})
		}

		return messages, nil
	}
}

// getCompressionSummaryContext retrieves compression summary for the conversation
func (s *ChatService) getCompressionSummaryContext(conversationID string) string {
	if s.compressionService == nil || conversationID == "" {
		return ""
	}
	return s.compressionService.BuildSummaryContext(context.Background(), conversationID)
}

// getMemoryContext retrieves relevant memories for the conversation
func (s *ChatService) getMemoryContext(workspaceID, conversationID string, agentID *string, recentQuery string) string {
	if s.memoryService == nil || workspaceID == "" {
		return ""
	}

	ctx := context.Background()

	// Build memory context with semantic search if query provided
	memoryContext, err := s.memoryService.BuildMemoryContext(ctx, workspaceID, agentID, recentQuery, 5000)
	if err != nil {
		s.logger.Warn("Failed to build memory context", "error", err)
		return ""
	}

	return memoryContext
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

		// Add container IP if available (for docker workspaces)
		if workspace.Runtime.ContainerIP != nil && *workspace.Runtime.ContainerIP != "" {
			sb.WriteString(fmt.Sprintf("container_ip: %s\n", *workspace.Runtime.ContainerIP))
			sb.WriteString("\n--- IMPORTANT: Browser Access in Container ---\n")
			sb.WriteString("When you start a web server in this container and want to view it with the browser:\n")
			sb.WriteString(fmt.Sprintf("- Use container IP: %s (NOT localhost or 127.0.0.1)\n", *workspace.Runtime.ContainerIP))
			sb.WriteString("- Server must bind to 0.0.0.0 (not 127.0.0.1)\n")
			sb.WriteString(fmt.Sprintf("- Example: browser_go_to_url with http://%s:PORT\n", *workspace.Runtime.ContainerIP))
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

		if len(toolsInfo) > 0 {
			chatModel, err = chatModel.WithTools(toolsInfo)
			if err != nil {
				return nil, fmt.Errorf("failed to bind tools: %w", err)
			}
		}
	}

	// Generate response
	response, err := chatModel.Generate(ctx, history)
	if err != nil {
		return nil, fmt.Errorf("failed to generate response: %w", err)
	}

	// Update assistant message using Chunks
	if response.ReasoningContent != "" {
		assistantMsg.AddReasoningChunk(response.ReasoningContent, 0)
	}
	if response.Content != "" {
		assistantMsg.AddTextChunk(response.Content, 0)
	}
	assistantMsg.Status = models.MessageStatusCompleted
	assistantMsg.FinishReason = models.FinishReasonStop

	// Handle tool calls if any
	if len(response.ToolCalls) > 0 {
		assistantMsg.FinishReason = models.FinishReasonToolCalls
		for _, tc := range response.ToolCalls {
			assistantMsg.AddToolCallChunk(tc.ID, tc.Function.Name, tc.Function.Arguments, 0)
		}
	}

	// Update usage if available
	if response.ResponseMeta != nil && response.ResponseMeta.Usage != nil {
		assistantMsg.Usage = &db.TokenUsage{
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
	// Load workspace tools
	workspaceTools, err := s.loadWorkspaceTools(ctx, req.WorkspaceID, conv.ID)
	if err != nil {
		s.logger.Warn("Failed to load workspace tools", "error", err)
	}

	// Build conversation history
	history, err := s.buildConversationHistory(conv.ID)
	if err != nil {
		return assistantMsg, err
	}

	// Get model ID
	modelID := req.Model
	if modelID == "" {
		return assistantMsg, ErrModelNotConfigured
	}

	// Convert []tool.InvokableTool to []tool.BaseTool
	baseTools := make([]tool.BaseTool, len(workspaceTools))
	for i, t := range workspaceTools {
		baseTools[i] = t
	}

	// Build agent based on AgentID
	var agent adk.Agent

	// Determine root agent name for compression middleware
	// This will be updated after building the workspace agent if AgentID is provided
	rootAgentName := "chat" // Default agent name

	// Create context reduction middlewares and retry config
	// Note: rootAgentName may be updated after building workspace agent
	middlewares := s.createCompressionMiddlewares(conv.ID, req.WorkspaceID, rootAgentName)
	retryConfig := s.createModelRetryConfig(conv.ID)

	if req.AgentID != "" {
		// Load WorkspaceAgent from database
		agent, err = s.buildWorkspaceAgent(ctx, req.AgentID, req.WorkspaceID, conv.ID, modelID, baseTools)
		if err != nil {
			return assistantMsg, fmt.Errorf("failed to build workspace agent: %w", err)
		}
		// Get the agent name from the built agent
		rootAgentName = agent.Name(ctx)
		// Recreate middlewares with correct root agent name
		middlewares = s.createCompressionMiddlewares(conv.ID, req.WorkspaceID, rootAgentName)
	} else {
		// Default: create simple ChatModelAgent
		chatModel, err := s.getChatModel(ctx, modelID)
		if err != nil {
			return assistantMsg, fmt.Errorf("failed to get chat model: %w", err)
		}

		// Use static instruction for context cache optimization
		staticInstruction := s.getStaticInstruction()
		// Create GenModelInput for dynamic context injection
		genModelInput := s.createGenModelInput(req.WorkspaceID, conv.ID)

		agent, err = adk.NewChatModelAgent(ctx, &adk.ChatModelAgentConfig{
			Name:          "Workspace Assistant",
			Description:   "An AI assistant that helps with coding and development tasks in the workspace",
			Instruction:   staticInstruction,
			GenModelInput: genModelInput,
			Model:         chatModel,
			ToolsConfig: adk.ToolsConfig{
				ToolsNodeConfig:    compose.ToolsNodeConfig{Tools: baseTools},
				EmitInternalEvents: true, // Enable streaming from agent tools
			},
			MaxIterations:    50,
			Middlewares:      middlewares,
			ModelRetryConfig: retryConfig,
		})
		if err != nil {
			return assistantMsg, fmt.Errorf("failed to create agent: %w", err)
		}
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

	// Track current assistantMsg
	currentAssistantMsg := assistantMsg

	// Track if we've already handled cancellation (to avoid double save)
	cancelled := false

	// Track current agent name for display
	currentAgentName := ""

	for {
		// Check for cancellation before getting next chunk
		select {
		case <-ctx.Done():
			if !cancelled {
				cancelled = true
				currentAssistantMsg.Status = models.MessageStatusCompleted
				currentAssistantMsg.FinishReason = models.FinishReasonCancelled
				s.SaveMessage(currentAssistantMsg)
			}
			return currentAssistantMsg, ctx.Err()
		default:
		}

		chunk, ok := iter.Next()
		if !ok {
			break
		}
		if chunk.Err != nil {
			// Check if this is a cancellation error
			if errors.Is(chunk.Err, context.Canceled) || errors.Is(chunk.Err, context.DeadlineExceeded) {
				if !cancelled {
					cancelled = true
					currentAssistantMsg.Status = models.MessageStatusCompleted
					currentAssistantMsg.FinishReason = models.FinishReasonCancelled
					s.SaveMessage(currentAssistantMsg)
				}
				return currentAssistantMsg, chunk.Err
			}

			// Other errors (including context length) are handled by ModelRetryConfig
			// If we reach here, all retries have been exhausted
			s.logger.Error("Agent iteration error", "error", chunk.Err)
			return currentAssistantMsg, fmt.Errorf("agent error: %w", chunk.Err)
		}

		// Update current agent name from chunk (each chunk carries its agent name)
		if chunk.AgentName != "" {
			currentAgentName = chunk.AgentName
		}

		// Skip events with no output (e.g., transfer actions)
		if chunk.Output == nil || chunk.Output.MessageOutput == nil {
			continue
		}

		// Check the role of this message output
		msgRole := chunk.Output.MessageOutput.Role

		if msgRole == schema.Tool {
			// This is a tool execution result
			fullMsg, err := chunk.Output.MessageOutput.GetMessage()
			if err != nil {
				s.logger.Error("Failed to get tool result message", "error", err)
				continue
			}

			// Get current round index from the assistant message
			roundIndex := currentAssistantMsg.GetMaxRoundIndex()

			// Add tool result to current assistant message's chunks and save to database
			if err := s.AddAndSaveToolResultChunk(currentAssistantMsg, fullMsg.ToolCallID, fullMsg.ToolName, fullMsg.Content, roundIndex, currentAgentName); err != nil {
				s.logger.Warn("Failed to save tool result chunk", "error", err)
			}

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
							AgentName:  currentAgentName,
						},
					},
				},
			})

			// Continue to next iteration - more content may follow
		} else if msgRole == schema.Assistant {
			// This is an assistant message - handle streaming or non-streaming content
			var streamedMsg *schema.Message
			var err error

			// Get current round index for this response
			roundIndex := currentAssistantMsg.GetMaxRoundIndex()

			// Check if this is a streaming message
			if chunk.Output.MessageOutput.IsStreaming && chunk.Output.MessageOutput.MessageStream != nil {
				// Collect all chunks for concatenation at the end (to get tool calls)
				var allChunks []*schema.Message

				for {
					// Check for cancellation during streaming
					select {
					case <-ctx.Done():
						if !cancelled {
							cancelled = true
							currentAssistantMsg.Status = models.MessageStatusCompleted
							currentAssistantMsg.FinishReason = models.FinishReasonCancelled
							s.SaveMessage(currentAssistantMsg)
						}
						return currentAssistantMsg, ctx.Err()
					default:
					}

					chunk, recvErr := chunk.Output.MessageOutput.MessageStream.Recv()
					if errors.Is(recvErr, io.EOF) {
						break
					}
					if recvErr != nil {
						// Check if error is due to context cancellation
						if ctx.Err() != nil || errors.Is(recvErr, context.Canceled) {
							if !cancelled {
								cancelled = true
								currentAssistantMsg.Status = models.MessageStatusCompleted
								currentAssistantMsg.FinishReason = models.FinishReasonCancelled
								s.SaveMessage(currentAssistantMsg)
							}
							return currentAssistantMsg, ctx.Err()
						}
						s.logger.Error("Agent stream error", "error", recvErr)
						return currentAssistantMsg, fmt.Errorf("stream error: %w", recvErr)
					}

					// Collect chunk for tool calls extraction at the end
					allChunks = append(allChunks, chunk)

					// Real-time save each chunk to database and send to client
					if chunk.Content != "" {
						// Save chunk to database and add to message.Chunks
						if err := s.AddAndSaveTextChunk(currentAssistantMsg, chunk.Content, roundIndex, currentAgentName); err != nil {
							s.logger.Warn("Failed to save streaming text chunk", "error", err)
						}

						// Send to client
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
										Content:   chunk.Content,
										AgentName: currentAgentName,
									},
								},
							},
						})
					}
					if chunk.ReasoningContent != "" {
						// Save chunk to database and add to message.Chunks
						if err := s.AddAndSaveReasoningChunk(currentAssistantMsg, chunk.ReasoningContent, roundIndex, currentAgentName); err != nil {
							s.logger.Warn("Failed to save streaming reasoning chunk", "error", err)
						}

						// Send to client
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
										AgentName:        currentAgentName,
									},
								},
							},
						})
					}
				}

				// Concat all chunks to get the complete message (including tool calls)
				if len(allChunks) > 0 {
					streamedMsg, err = schema.ConcatMessages(allChunks)
					if err != nil {
						s.logger.Error("Failed to concat streaming messages", "error", err)
						streamedMsg = &schema.Message{Role: schema.Assistant}
					}
				} else {
					streamedMsg = &schema.Message{Role: schema.Assistant}
				}
			} else {
				// Non-streaming message - get it directly
				streamedMsg, err = chunk.Output.MessageOutput.GetMessage()
				if err != nil {
					s.logger.Error("Failed to get message", "error", err)
					continue
				}

				// Save and send non-streaming content
				if streamedMsg.Content != "" {
					if err := s.AddAndSaveTextChunk(currentAssistantMsg, streamedMsg.Content, roundIndex, currentAgentName); err != nil {
						s.logger.Warn("Failed to save text chunk", "error", err)
					}

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
									Content:   streamedMsg.Content,
									AgentName: currentAgentName,
								},
							},
						},
					})
				}
				if streamedMsg.ReasoningContent != "" {
					if err := s.AddAndSaveReasoningChunk(currentAssistantMsg, streamedMsg.ReasoningContent, roundIndex, currentAgentName); err != nil {
						s.logger.Warn("Failed to save reasoning chunk", "error", err)
					}

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
									ReasoningContent: streamedMsg.ReasoningContent,
									AgentName:        currentAgentName,
								},
							},
						},
					})
				}
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

	// Trigger async memory extraction after conversation round completes
	if s.memoryExtractionService != nil {
		// Capture modelID for the goroutine
		extractModelID := modelID
		go func() {
			extractCtx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
			defer cancel()
			if err := s.memoryExtractionService.AnalyzeAndUpdateConversation(extractCtx, conv.WorkspaceID, conv.ID, extractModelID); err != nil {
				s.logger.Debug("Async memory extraction failed", "error", err)
			}
		}()
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

	// Extract content from Chunks
	apiMsg.Content = msg.GetTextContent()
	apiMsg.ReasoningContent = msg.GetReasoningContent()

	// Extract tool calls from Chunks and convert to models.ToolCall
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

// buildWorkspaceAgent builds an ADK Agent from a WorkspaceAgent configuration
func (s *ChatService) buildWorkspaceAgent(ctx context.Context, agentID, workspaceID, conversationID, defaultModelID string, baseTools []tool.BaseTool) (adk.Agent, error) {
	// Load WorkspaceAgent from database
	var wsAgent models.WorkspaceAgent
	if err := s.db.First(&wsAgent, "id = ? AND workspace_id = ?", agentID, workspaceID).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrAgentNotFound
		}
		return nil, fmt.Errorf("failed to load workspace agent: %w", err)
	}

	// Find the entry agent node (connected from start node)
	var entryAgent *models.Agent

	// First, find the node connected from "start" via edges
	var entryNodeID string
	for _, edge := range wsAgent.Edges {
		if edge.Source == "start" {
			entryNodeID = edge.Target
			break
		}
	}

	// If found an edge from start, find the corresponding agent node
	if entryNodeID != "" {
		for _, node := range wsAgent.Nodes {
			if node.ID == entryNodeID && node.Type == "agent" && node.Agent != nil {
				entryAgent = node.Agent
				break
			}
		}
	}

	// Fallback: if no edge from start found, use the first agent node
	if entryAgent == nil {
		for _, node := range wsAgent.Nodes {
			if node.Type == "agent" && node.Agent != nil {
				entryAgent = node.Agent
				break
			}
		}
	}

	if entryAgent == nil {
		return nil, fmt.Errorf("no agent node found in workspace agent %s", agentID)
	}

	// Build agent based on type
	return s.buildAgentFromConfig(ctx, entryAgent, defaultModelID, baseTools, &wsAgent, workspaceID, conversationID)
}

// buildAgentFromConfig builds an ADK Agent from an Agent configuration
func (s *ChatService) buildAgentFromConfig(ctx context.Context, agentConfig *models.Agent, defaultModelID string, baseTools []tool.BaseTool, wsAgent *models.WorkspaceAgent, workspaceID string, conversationID string) (adk.Agent, error) {
	// Determine model ID (format: provider/model)
	modelID := defaultModelID
	if agentConfig.ModelProvider != nil && *agentConfig.ModelProvider != "" &&
		agentConfig.ModelName != nil && *agentConfig.ModelName != "" {
		// Use agent's configured provider and model
		modelID = *agentConfig.ModelProvider + "/" + *agentConfig.ModelName
	}

	// Get chat model
	chatModel, err := s.getChatModel(ctx, modelID)
	if err != nil {
		return nil, fmt.Errorf("failed to get chat model for agent %s: %w", agentConfig.Name, err)
	}

	// Build static instruction (for context cache optimization)
	instruction := ""
	if agentConfig.Instruction != nil {
		instruction = *agentConfig.Instruction
	}

	// Create GenModelInput for dynamic context injection
	genModelInput := s.createGenModelInput(workspaceID, conversationID)

	// Filter tools based on agent's toolIds
	agentTools := baseTools
	if len(agentConfig.ToolIDs) > 0 {
		toolSet := make(map[string]bool)
		for _, id := range agentConfig.ToolIDs {
			toolSet[id] = true
		}
		filtered := make([]tool.BaseTool, 0)
		for _, t := range baseTools {
			info, _ := t.Info(ctx)
			if info != nil && toolSet[info.Name] {
				filtered = append(filtered, t)
			}
		}
		if len(filtered) > 0 {
			agentTools = filtered
		}
	}

	// Get max iterations
	maxIterations := 50
	if agentConfig.MaxIterations != nil && *agentConfig.MaxIterations > 0 {
		maxIterations = *agentConfig.MaxIterations
	}

	// Create context reduction middleware and retry config
	// Pass agentConfig.Name as rootAgentName to ensure only root agent triggers compression
	middlewares := s.createCompressionMiddlewares(conversationID, workspaceID, agentConfig.Name)
	retryConfig := s.createModelRetryConfig(conversationID)

	// Build agent based on type
	switch agentConfig.Type {
	case "chat_model":
		return adk.NewChatModelAgent(ctx, &adk.ChatModelAgentConfig{
			Name:          agentConfig.Name,
			Description:   ptrToString(agentConfig.Description),
			Instruction:   instruction,
			GenModelInput: genModelInput,
			Model:         chatModel,
			ToolsConfig: adk.ToolsConfig{
				ToolsNodeConfig:    compose.ToolsNodeConfig{Tools: agentTools},
				EmitInternalEvents: true, // Enable streaming from agent tools
			},
			MaxIterations:    maxIterations,
			Middlewares:      middlewares,
			ModelRetryConfig: retryConfig,
		})

	case "supervisor":
		// Build sub-agents
		subAgents, err := s.buildSubAgents(ctx, wsAgent, agentConfig, defaultModelID, baseTools, workspaceID, conversationID)
		if err != nil {
			return nil, fmt.Errorf("failed to build sub-agents for supervisor: %w", err)
		}
		// Create the supervisor agent itself (a ChatModelAgent)
		supervisorAgent, err := adk.NewChatModelAgent(ctx, &adk.ChatModelAgentConfig{
			Name:          agentConfig.Name,
			Description:   ptrToString(agentConfig.Description),
			Instruction:   instruction,
			GenModelInput: genModelInput,
			Model:         chatModel,
			ToolsConfig: adk.ToolsConfig{
				ToolsNodeConfig:    compose.ToolsNodeConfig{Tools: agentTools},
				EmitInternalEvents: true, // Enable streaming from sub-agents
			},
			MaxIterations:    maxIterations,
			Middlewares:      middlewares,
			ModelRetryConfig: retryConfig,
		})
		if err != nil {
			return nil, fmt.Errorf("failed to create supervisor agent: %w", err)
		}
		return supervisor.New(ctx, &supervisor.Config{
			Supervisor: supervisorAgent,
			SubAgents:  subAgents,
		})

	case "deep":
		// Build sub-agents if configured
		var subAgents []adk.Agent
		if wsAgent != nil {
			subAgents, err = s.buildSubAgents(ctx, wsAgent, agentConfig, defaultModelID, baseTools, workspaceID, conversationID)
			if err != nil {
				s.logger.Warn("Failed to build sub-agents for deep agent", "error", err)
			}
		}

		// Parse type-specific config
		withoutWriteTodos := false
		withoutGeneralSubAgent := false
		if agentConfig.TypeConfig != nil {
			if v, ok := agentConfig.TypeConfig["withoutWriteTodos"].(bool); ok {
				withoutWriteTodos = v
			}
			if v, ok := agentConfig.TypeConfig["withoutGeneralSubAgent"].(bool); ok {
				withoutGeneralSubAgent = v
			}
		}

		return deep.New(ctx, &deep.Config{
			Name:        agentConfig.Name,
			Description: ptrToString(agentConfig.Description),
			Instruction: instruction,
			ChatModel:   chatModel,
			SubAgents:   subAgents,
			ToolsConfig: adk.ToolsConfig{
				ToolsNodeConfig:    compose.ToolsNodeConfig{Tools: agentTools},
				EmitInternalEvents: true, // Enable streaming from sub-agents
			},
			MaxIteration:           maxIterations,
			WithoutWriteTodos:      withoutWriteTodos,
			WithoutGeneralSubAgent: withoutGeneralSubAgent,
		})

	case "sequential":
		// Build sub-agents for sequential execution
		subAgents, err := s.buildSubAgents(ctx, wsAgent, agentConfig, defaultModelID, baseTools, workspaceID, conversationID)
		if err != nil {
			return nil, fmt.Errorf("failed to build sub-agents for sequential: %w", err)
		}
		return adk.NewSequentialAgent(ctx, &adk.SequentialAgentConfig{
			Name:        agentConfig.Name,
			Description: ptrToString(agentConfig.Description),
			SubAgents:   subAgents,
		})

	case "loop":
		// Build sub-agents for loop execution
		subAgents, err := s.buildSubAgents(ctx, wsAgent, agentConfig, defaultModelID, baseTools, workspaceID, conversationID)
		if err != nil {
			return nil, fmt.Errorf("failed to build sub-agents for loop: %w", err)
		}
		return adk.NewLoopAgent(ctx, &adk.LoopAgentConfig{
			Name:          agentConfig.Name,
			Description:   ptrToString(agentConfig.Description),
			SubAgents:     subAgents,
			MaxIterations: maxIterations,
		})

	case "parallel":
		// Build sub-agents for parallel execution
		subAgents, err := s.buildSubAgents(ctx, wsAgent, agentConfig, defaultModelID, baseTools, workspaceID, conversationID)
		if err != nil {
			return nil, fmt.Errorf("failed to build sub-agents for parallel: %w", err)
		}
		return adk.NewParallelAgent(ctx, &adk.ParallelAgentConfig{
			Name:        agentConfig.Name,
			Description: ptrToString(agentConfig.Description),
			SubAgents:   subAgents,
		})

	case "plan_execute":
		// Create plan-execute agent with planner, executor, and replanner
		// The executor uses the provided tools to execute each step
		toolCallingModel, ok := chatModel.(model.ToolCallingChatModel)
		if !ok {
			return nil, fmt.Errorf("plan_execute agent requires a tool-calling capable model")
		}

		// Create planner agent
		planner, err := planexecute.NewPlanner(ctx, &planexecute.PlannerConfig{
			ToolCallingChatModel: toolCallingModel,
		})
		if err != nil {
			return nil, fmt.Errorf("failed to create planner: %w", err)
		}

		// Create executor agent - a ChatModelAgent with tools
		executor, err := adk.NewChatModelAgent(ctx, &adk.ChatModelAgentConfig{
			Name:          agentConfig.Name + "_executor",
			Description:   "Executes individual steps of the plan",
			Instruction:   instruction,
			GenModelInput: genModelInput,
			Model:         chatModel,
			ToolsConfig: adk.ToolsConfig{
				ToolsNodeConfig:    compose.ToolsNodeConfig{Tools: agentTools},
				EmitInternalEvents: true, // Enable streaming from agent tools
			},
			MaxIterations:    maxIterations,
			Middlewares:      middlewares,
			ModelRetryConfig: retryConfig,
		})
		if err != nil {
			return nil, fmt.Errorf("failed to create executor: %w", err)
		}

		// Create replanner agent
		replanner, err := planexecute.NewReplanner(ctx, &planexecute.ReplannerConfig{
			ChatModel: toolCallingModel,
		})
		if err != nil {
			return nil, fmt.Errorf("failed to create replanner: %w", err)
		}

		// Create the plan-execute agent
		return planexecute.New(ctx, &planexecute.Config{
			Planner:       planner,
			Executor:      executor,
			Replanner:     replanner,
			MaxIterations: maxIterations,
		})

	default:
		return nil, fmt.Errorf("unsupported agent type: %s", agentConfig.Type)
	}
}

// buildSubAgents builds sub-agents for a supervisor agent based on canvas edges
func (s *ChatService) buildSubAgents(ctx context.Context, wsAgent *models.WorkspaceAgent, parentAgent *models.Agent, defaultModelID string, baseTools []tool.BaseTool, workspaceID string, conversationID string) ([]adk.Agent, error) {
	if wsAgent == nil {
		return nil, nil
	}

	// Find the parent node
	var parentNodeID string
	for _, node := range wsAgent.Nodes {
		if node.Agent != nil && node.Agent.ID == parentAgent.ID {
			parentNodeID = node.ID
			break
		}
	}

	if parentNodeID == "" {
		return nil, nil
	}

	// Find connected sub-agent nodes via edges
	subAgentNodeIDs := make([]string, 0)
	for _, edge := range wsAgent.Edges {
		if edge.Source == parentNodeID && edge.Target != "start" {
			subAgentNodeIDs = append(subAgentNodeIDs, edge.Target)
		}
	}

	// Build sub-agents
	subAgents := make([]adk.Agent, 0, len(subAgentNodeIDs))
	for _, nodeID := range subAgentNodeIDs {
		for _, node := range wsAgent.Nodes {
			if node.ID == nodeID && node.Agent != nil {
				// Recursively build sub-agent (but pass nil for wsAgent to prevent infinite recursion for supervisor)
				subAgent, err := s.buildAgentFromConfig(ctx, node.Agent, defaultModelID, baseTools, nil, workspaceID, conversationID)
				if err != nil {
					s.logger.Warn("Failed to build sub-agent", "nodeID", nodeID, "error", err)
					continue
				}
				subAgents = append(subAgents, subAgent)
			}
		}
	}

	return subAgents, nil
}

// ptrToString safely converts *string to string
func ptrToString(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}
