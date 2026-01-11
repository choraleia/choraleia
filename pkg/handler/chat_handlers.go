// Chat HTTP handlers - OpenAI-compatible API
package handler

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"

	"github.com/choraleia/choraleia/pkg/models"
	"github.com/choraleia/choraleia/pkg/service"
	"github.com/gin-gonic/gin"
)

// ChatHandler handles chat-related HTTP requests
type ChatHandler struct {
	chatService *service.ChatService
}

// NewChatHandler creates a new chat handler
func NewChatHandler(chatService *service.ChatService) *ChatHandler {
	return &ChatHandler{
		chatService: chatService,
	}
}

// RegisterRoutes registers chat routes
func (h *ChatHandler) RegisterRoutes(r *gin.RouterGroup) {
	// OpenAI-compatible chat completions endpoint
	r.POST("/chat/completions", h.ChatCompletions)

	// Conversation management
	conversations := r.Group("/conversations")
	{
		conversations.POST("", h.CreateConversation)
		conversations.GET("", h.ListConversations)
		conversations.GET("/:id", h.GetConversation)
		conversations.PATCH("/:id", h.UpdateConversation)
		conversations.DELETE("/:id", h.DeleteConversation)

		// Messages
		conversations.GET("/:id/messages", h.GetMessages)
	}

	// Stream management
	r.POST("/chat/cancel", h.CancelStream)
	r.GET("/chat/status/:conversation_id", h.GetStreamStatus)
	r.GET("/chat/state/:conversation_id", h.GetStreamState)
	r.GET("/chat/completions/continue/:conversation_id", h.ContinueStream)
}

// ChatCompletions handles OpenAI-compatible chat completions
// POST /api/v1/chat/completions?workspace_id=xxx
func (h *ChatHandler) ChatCompletions(c *gin.Context) {
	var req models.ChatCompletionRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Get workspace_id from query param if not in body
	if req.WorkspaceID == "" {
		req.WorkspaceID = c.Query("workspace_id")
	}
	if req.WorkspaceID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "workspace_id is required"})
		return
	}

	if req.Stream {
		h.handleStreamingChat(c, &req)
	} else {
		h.handleNonStreamingChat(c, &req)
	}
}

func (h *ChatHandler) handleNonStreamingChat(c *gin.Context, req *models.ChatCompletionRequest) {
	response, err := h.chatService.Chat(c.Request.Context(), req)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, response)
}

func (h *ChatHandler) handleStreamingChat(c *gin.Context, req *models.ChatCompletionRequest) {
	// Set SSE headers
	c.Header("Content-Type", "text/event-stream")
	c.Header("Cache-Control", "no-cache")
	c.Header("Connection", "keep-alive")
	c.Header("X-Accel-Buffering", "no") // Disable nginx buffering

	chunks, err := h.chatService.ChatStream(c.Request.Context(), req)
	if err != nil {
		// For SSE, we need to send error as event
		c.SSEvent("error", gin.H{"error": err.Error()})
		return
	}

	// Get response writer for flushing
	w := c.Writer

	// Stream chunks
	for chunk := range chunks {
		data, err := json.Marshal(chunk)
		if err != nil {
			continue
		}

		// Write SSE event
		fmt.Fprintf(w, "data: %s\n\n", data)
		w.Flush()
	}

	// Send done event
	fmt.Fprintf(w, "data: [DONE]\n\n")
	w.Flush()
}

// CreateConversation creates a new conversation
// POST /api/v1/conversations
func (h *ChatHandler) CreateConversation(c *gin.Context) {
	var req models.CreateConversationRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Get workspace_id from query param if not in body
	if req.WorkspaceID == "" {
		req.WorkspaceID = c.Query("workspace_id")
	}
	if req.WorkspaceID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "workspace_id is required"})
		return
	}

	conv, err := h.chatService.CreateConversation(&req)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusCreated, conv)
}

// ListConversations lists conversations
// GET /api/v1/conversations?workspace_id=xxx&status=active&limit=20&offset=0
func (h *ChatHandler) ListConversations(c *gin.Context) {
	workspaceID := c.Query("workspace_id")
	if workspaceID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "workspace_id is required"})
		return
	}

	status := c.Query("status")
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "20"))
	offset, _ := strconv.Atoi(c.DefaultQuery("offset", "0"))

	if limit <= 0 || limit > 100 {
		limit = 20
	}

	conversations, hasMore, err := h.chatService.ListConversations(workspaceID, status, limit, offset)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, models.ConversationListResponse{
		Conversations: conversations,
		HasMore:       hasMore,
	})
}

// GetConversation gets a conversation by ID
// GET /api/v1/conversations/:id
func (h *ChatHandler) GetConversation(c *gin.Context) {
	id := c.Param("id")

	conv, err := h.chatService.GetConversation(id)
	if err != nil {
		if err == service.ErrConversationNotFound {
			c.JSON(http.StatusNotFound, gin.H{"error": "conversation not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, conv)
}

// UpdateConversation updates a conversation
// PATCH /api/v1/conversations/:id
func (h *ChatHandler) UpdateConversation(c *gin.Context) {
	id := c.Param("id")

	var req models.UpdateConversationRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	conv, err := h.chatService.UpdateConversation(id, &req)
	if err != nil {
		if err == service.ErrConversationNotFound {
			c.JSON(http.StatusNotFound, gin.H{"error": "conversation not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, conv)
}

// DeleteConversation deletes a conversation
// DELETE /api/v1/conversations/:id
func (h *ChatHandler) DeleteConversation(c *gin.Context) {
	id := c.Param("id")

	if err := h.chatService.DeleteConversation(id); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"deleted": true})
}

// GetMessages gets messages for a conversation
// GET /api/v1/conversations/:id/messages
func (h *ChatHandler) GetMessages(c *gin.Context) {
	conversationID := c.Param("id")

	messages, err := h.chatService.GetMessages(conversationID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	// Return messages directly - db.Message structure matches API contract
	c.JSON(http.StatusOK, gin.H{
		"messages": messages,
	})
}

// streamResponse handles SSE streaming for chat responses
func (h *ChatHandler) streamResponse(c *gin.Context, chunks <-chan *models.ChatCompletionChunk) {
	c.Header("Content-Type", "text/event-stream")
	c.Header("Cache-Control", "no-cache")
	c.Header("Connection", "keep-alive")
	c.Header("X-Accel-Buffering", "no")

	sseWriter := NewSSEWriter(c.Writer)

	for chunk := range chunks {
		if err := sseWriter.WriteEvent("", chunk); err != nil {
			break
		}
	}

	// Send done event
	fmt.Fprintf(c.Writer, "data: [DONE]\n\n")
	if sseWriter.flusher != nil {
		sseWriter.flusher.Flush()
	}
}

// CancelStream cancels an active streaming session
// POST /api/v1/chat/cancel
func (h *ChatHandler) CancelStream(c *gin.Context) {
	var req struct {
		ConversationID string `json:"conversation_id"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if err := h.chatService.CancelStream(req.ConversationID); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"cancelled": true})
}

// GetStreamStatus checks if a conversation has an active stream
// GET /api/v1/chat/status/:conversation_id
func (h *ChatHandler) GetStreamStatus(c *gin.Context) {
	conversationID := c.Param("conversation_id")
	if conversationID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "conversation_id is required"})
		return
	}

	isStreaming := h.chatService.IsStreaming(conversationID)
	c.JSON(http.StatusOK, gin.H{
		"conversation_id": conversationID,
		"is_streaming":    isStreaming,
	})
}

// GetStreamState returns the current streaming state with buffer content for reconnection
// GET /api/v1/chat/state/:conversation_id
func (h *ChatHandler) GetStreamState(c *gin.Context) {
	conversationID := c.Param("conversation_id")
	if conversationID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "conversation_id is required"})
		return
	}

	state := h.chatService.GetStreamState(conversationID)
	c.JSON(http.StatusOK, state)
}

// ContinueStream allows reconnecting to an active stream
// GET /api/v1/chat/completions/continue/:conversation_id
// This endpoint:
// 1. First replays all buffered chunks from history
// 2. Then subscribes to receive new chunks until the stream completes
func (h *ChatHandler) ContinueStream(c *gin.Context) {
	conversationID := c.Param("conversation_id")
	if conversationID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "conversation_id is required"})
		return
	}

	// Get current stream state
	state := h.chatService.GetStreamState(conversationID)
	if !state.IsStreaming {
		c.JSON(http.StatusNotFound, gin.H{"error": "no active stream for this conversation"})
		return
	}

	// Get buffered history events (all chunks since the beginning)
	historyEvents := h.chatService.GetStreamEvents(conversationID, 0)

	// Subscribe to receive new chunks
	chunks, unsubscribe := h.chatService.SubscribeToStream(conversationID)
	if chunks == nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "stream ended or not found"})
		return
	}
	defer unsubscribe()

	// Get done channel
	done := h.chatService.GetStreamDoneChannel(conversationID)

	// Set SSE headers
	c.Header("Content-Type", "text/event-stream")
	c.Header("Cache-Control", "no-cache")
	c.Header("Connection", "keep-alive")
	c.Header("X-Accel-Buffering", "no")

	w := c.Writer

	// First, replay all buffered history chunks
	for _, event := range historyEvents {
		if chunk, ok := event.Data.(*models.ChatCompletionChunk); ok {
			data, err := json.Marshal(chunk)
			if err != nil {
				continue
			}
			fmt.Fprintf(w, "data: %s\n\n", data)
			w.Flush()
		}
	}

	// Now stream new chunks as they arrive
	for {
		select {
		case chunk, ok := <-chunks:
			if !ok {
				// Channel closed, stream ended
				fmt.Fprintf(w, "data: [DONE]\n\n")
				w.Flush()
				return
			}
			data, err := json.Marshal(chunk)
			if err != nil {
				continue
			}
			fmt.Fprintf(w, "data: %s\n\n", data)
			w.Flush()

		case <-done:
			// Stream completed
			fmt.Fprintf(w, "data: [DONE]\n\n")
			w.Flush()
			return

		case <-c.Request.Context().Done():
			// Client disconnected
			return
		}
	}
}

// SSEWriter wraps gin.ResponseWriter for proper SSE streaming
type SSEWriter struct {
	writer  gin.ResponseWriter
	flusher http.Flusher
}

// NewSSEWriter creates a new SSE writer
func NewSSEWriter(w gin.ResponseWriter) *SSEWriter {
	flusher, _ := w.(http.Flusher)
	return &SSEWriter{
		writer:  w,
		flusher: flusher,
	}
}

// WriteEvent writes an SSE event
func (w *SSEWriter) WriteEvent(event string, data interface{}) error {
	jsonData, err := json.Marshal(data)
	if err != nil {
		return err
	}

	if event != "" {
		fmt.Fprintf(w.writer, "event: %s\n", event)
	}
	fmt.Fprintf(w.writer, "data: %s\n\n", jsonData)

	if w.flusher != nil {
		w.flusher.Flush()
	}
	return nil
}

// WriteDone writes the done event
func (w *SSEWriter) WriteDone() {
	fmt.Fprintf(w.writer, "data: [DONE]\n\n")
	if w.flusher != nil {
		w.flusher.Flush()
	}
}
