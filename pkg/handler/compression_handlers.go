// Compression API handlers
package handler

import (
	"net/http"

	"github.com/choraleia/choraleia/pkg/service"
	"github.com/gin-gonic/gin"
)

// CompressionHandler handles compression-related API requests
type CompressionHandler struct {
	compressionService *service.CompressionService
}

// NewCompressionHandler creates a new compression handler
func NewCompressionHandler(compressionService *service.CompressionService) *CompressionHandler {
	return &CompressionHandler{
		compressionService: compressionService,
	}
}

// RegisterRoutes registers compression routes
func (h *CompressionHandler) RegisterRoutes(r *gin.RouterGroup) {
	// Routes under /api/conversations/:id/
	r.GET("/conversations/:id/snapshots", h.GetSnapshots)
	r.POST("/conversations/:id/compress", h.Compress)
}

// GetSnapshots returns compression snapshots for a conversation
// GET /api/conversations/:id/snapshots
func (h *CompressionHandler) GetSnapshots(c *gin.Context) {
	conversationID := c.Param("id")
	if conversationID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "conversation_id is required"})
		return
	}

	snapshots, err := h.compressionService.GetSnapshots(c.Request.Context(), conversationID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"snapshots": snapshots,
		"count":     len(snapshots),
	})
}

// Compress manually triggers compression for a conversation
// POST /api/conversations/:id/compress
func (h *CompressionHandler) Compress(c *gin.Context) {
	conversationID := c.Param("id")
	if conversationID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "conversation_id is required"})
		return
	}

	snapshot, err := h.compressionService.Compress(c.Request.Context(), conversationID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	if snapshot == nil {
		c.JSON(http.StatusOK, gin.H{
			"message":  "No compression needed",
			"snapshot": nil,
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"message":  "Compression completed",
		"snapshot": snapshot,
	})
}
