// Memory API handlers
package handler

import (
	"net/http"

	"github.com/choraleia/choraleia/pkg/db"
	"github.com/choraleia/choraleia/pkg/service"
	"github.com/gin-gonic/gin"
)

// MemoryHandler handles memory-related API requests
type MemoryHandler struct {
	memoryService *service.MemoryService
}

// NewMemoryHandler creates a new memory handler
func NewMemoryHandler(memoryService *service.MemoryService) *MemoryHandler {
	return &MemoryHandler{
		memoryService: memoryService,
	}
}

// RegisterRoutes registers memory routes
func (h *MemoryHandler) RegisterRoutes(r *gin.RouterGroup) {
	memories := r.Group("/workspaces/:id/memories")
	{
		memories.GET("", h.ListMemories)
		memories.POST("", h.CreateMemory)
		memories.GET("/:memory_id", h.GetMemory)
		memories.GET("/:memory_id/source", h.GetMemorySource)
		memories.PUT("/:memory_id", h.UpdateMemory)
		memories.DELETE("/:memory_id", h.DeleteMemory)
		memories.POST("/search", h.SearchMemories)
	}
}

// ListMemories lists memories for a workspace
// GET /api/workspaces/:id/memories
func (h *MemoryHandler) ListMemories(c *gin.Context) {
	workspaceID := c.Param("id")

	// Parse query options
	opts := &db.MemoryQueryOptions{
		WorkspaceID: workspaceID,
		Limit:       50,
	}

	// Parse type filter
	if typeStr := c.Query("type"); typeStr != "" {
		opts.Types = []db.MemoryType{db.MemoryType(typeStr)}
	}

	// Parse category filter
	if category := c.Query("category"); category != "" {
		opts.Categories = []string{category}
	}

	// Parse scope filter
	if scopeStr := c.Query("scope"); scopeStr != "" {
		opts.Scopes = []db.MemoryScope{db.MemoryScope(scopeStr)}
	}

	// Parse keyword
	if keyword := c.Query("keyword"); keyword != "" {
		opts.Keyword = keyword
	}

	// Parse pagination
	if limit := c.Query("limit"); limit != "" {
		var l int
		if _, err := c.GetQuery("limit"); err {
			l = 50
		}
		opts.Limit = l
	}

	// Parse agent_id for filtering accessible memories
	var agentID *string
	if aid := c.Query("agent_id"); aid != "" {
		agentID = &aid
	}

	memories, err := h.memoryService.GetAccessibleMemories(c.Request.Context(), workspaceID, agentID, opts)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"memories": memories,
		"count":    len(memories),
	})
}

// CreateMemory creates a new memory
// POST /api/workspaces/:id/memories
func (h *MemoryHandler) CreateMemory(c *gin.Context) {
	workspaceID := c.Param("id")

	var req db.CreateMemoryRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	memory, err := h.memoryService.Store(c.Request.Context(), workspaceID, &req)
	if err != nil {
		if err == service.ErrInvalidMemoryScope {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusCreated, memory)
}

// GetMemory retrieves a single memory
// GET /api/workspaces/:id/memories/:memory_id
func (h *MemoryHandler) GetMemory(c *gin.Context) {
	memoryID := c.Param("memory_id")

	memory, err := h.memoryService.Get(c.Request.Context(), memoryID)
	if err != nil {
		if err == service.ErrMemoryNotFound {
			c.JSON(http.StatusNotFound, gin.H{"error": "memory not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, memory)
}

// UpdateMemory updates a memory
// PUT /api/workspaces/:id/memories/:memory_id
func (h *MemoryHandler) UpdateMemory(c *gin.Context) {
	memoryID := c.Param("memory_id")

	var req db.UpdateMemoryRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	memory, err := h.memoryService.Update(c.Request.Context(), memoryID, &req)
	if err != nil {
		if err == service.ErrMemoryNotFound {
			c.JSON(http.StatusNotFound, gin.H{"error": "memory not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, memory)
}

// DeleteMemory deletes a memory
// DELETE /api/workspaces/:id/memories/:memory_id
func (h *MemoryHandler) DeleteMemory(c *gin.Context) {
	memoryID := c.Param("memory_id")

	if err := h.memoryService.Delete(c.Request.Context(), memoryID); err != nil {
		if err == service.ErrMemoryNotFound {
			c.JSON(http.StatusNotFound, gin.H{"error": "memory not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "memory deleted"})
}

// SearchMemoriesRequest represents a search request
type SearchMemoriesRequest struct {
	Query   string   `json:"query" binding:"required"`
	AgentID *string  `json:"agent_id,omitempty"`
	Types   []string `json:"types,omitempty"`
	Limit   int      `json:"limit,omitempty"`
}

// SearchMemories performs semantic and keyword search
// POST /api/workspaces/:id/memories/search
func (h *MemoryHandler) SearchMemories(c *gin.Context) {
	workspaceID := c.Param("id")

	var req SearchMemoriesRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	limit := req.Limit
	if limit <= 0 {
		limit = 20
	}

	results, err := h.memoryService.SearchCombined(c.Request.Context(), workspaceID, req.Query, req.AgentID, limit)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"results": results,
		"count":   len(results),
	})
}

// MemorySourceInfo represents the source information of a memory
type MemorySourceInfo struct {
	SourceType       string `json:"source_type"`
	SourceID         string `json:"source_id,omitempty"`
	ConversationID   string `json:"conversation_id,omitempty"`
	ConversationName string `json:"conversation_name,omitempty"`
	SnapshotID       string `json:"snapshot_id,omitempty"`
	CreatedAt        string `json:"created_at,omitempty"`
}

// GetMemorySource retrieves the source context of a memory
// GET /api/workspaces/:id/memories/:memory_id/source
func (h *MemoryHandler) GetMemorySource(c *gin.Context) {
	memoryID := c.Param("memory_id")

	memory, err := h.memoryService.Get(c.Request.Context(), memoryID)
	if err != nil {
		if err == service.ErrMemoryNotFound {
			c.JSON(http.StatusNotFound, gin.H{"error": "memory not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	sourceInfo := MemorySourceInfo{
		SourceType: string(memory.SourceType),
	}

	if memory.SourceID != nil {
		sourceInfo.SourceID = *memory.SourceID

		// If source is a conversation, get conversation details
		if memory.SourceType == db.MemorySourceConversation {
			sourceInfo.ConversationID = *memory.SourceID
		}

		// If source is a compression snapshot, get snapshot and conversation info
		if memory.SourceType == db.MemorySourceCompression {
			sourceInfo.SnapshotID = *memory.SourceID
		}
	}

	sourceInfo.CreatedAt = memory.CreatedAt.Format("2006-01-02 15:04:05")

	c.JSON(http.StatusOK, sourceInfo)
}
