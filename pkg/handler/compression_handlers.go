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
	r.GET("/conversations/:id/snapshots/:snapshot_id/messages", h.GetSnapshotMessages)
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
// POST /api/conversations/:id/compress?model=provider/model
func (h *CompressionHandler) Compress(c *gin.Context) {
	conversationID := c.Param("id")
	if conversationID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "conversation_id is required"})
		return
	}

	// Get model from query parameter (format: provider/model)
	modelID := c.Query("model")

	snapshot, err := h.compressionService.Compress(c.Request.Context(), conversationID, modelID)
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

// GetSnapshotMessages returns the original messages for a compression snapshot
// GET /api/conversations/:id/snapshots/:snapshot_id/messages
func (h *CompressionHandler) GetSnapshotMessages(c *gin.Context) {
	snapshotID := c.Param("snapshot_id")
	if snapshotID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "snapshot_id is required"})
		return
	}

	messages, err := h.compressionService.GetSnapshotMessages(c.Request.Context(), snapshotID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"messages": messages,
		"count":    len(messages),
	})
}
