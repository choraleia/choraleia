// Memory extraction API handlers
package handler

import (
	"net/http"

	"github.com/choraleia/choraleia/pkg/service"
	"github.com/gin-gonic/gin"
)

// MemoryExtractionHandler handles memory extraction API requests
type MemoryExtractionHandler struct {
	extractionService *service.MemoryExtractionService
}

// NewMemoryExtractionHandler creates a new memory extraction handler
func NewMemoryExtractionHandler(extractionService *service.MemoryExtractionService) *MemoryExtractionHandler {
	return &MemoryExtractionHandler{
		extractionService: extractionService,
	}
}

// RegisterRoutes registers memory extraction routes
func (h *MemoryExtractionHandler) RegisterRoutes(r *gin.RouterGroup) {
	r.POST("/conversations/:id/analyze", h.AnalyzeConversation)
	r.POST("/conversations/:id/extract-topics", h.ExtractTopics)
}

// AnalyzeConversation performs full analysis on a conversation
// POST /api/conversations/:id/analyze
func (h *MemoryExtractionHandler) AnalyzeConversation(c *gin.Context) {
	conversationID := c.Param("id")
	workspaceID := c.Query("workspace_id")

	if conversationID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "conversation_id is required"})
		return
	}

	if workspaceID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "workspace_id query parameter is required"})
		return
	}

	// Get model from query parameter (format: provider/model)
	modelID := c.Query("model")

	err := h.extractionService.AnalyzeAndUpdateConversation(c.Request.Context(), workspaceID, conversationID, modelID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"message": "Analysis completed",
	})
}

// ExtractTopics extracts key topics from a conversation
// POST /api/conversations/:id/extract-topics?model=provider/model
func (h *MemoryExtractionHandler) ExtractTopics(c *gin.Context) {
	conversationID := c.Param("id")

	if conversationID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "conversation_id is required"})
		return
	}

	// Get model from query parameter (format: provider/model)
	modelID := c.Query("model")

	topics, err := h.extractionService.ExtractTopicsFromConversation(c.Request.Context(), conversationID, modelID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"topics": topics,
	})
}
