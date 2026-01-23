// Memory lifecycle API handlers
package handler

import (
	"io"
	"net/http"

	"github.com/choraleia/choraleia/pkg/service"
	"github.com/gin-gonic/gin"
)

// MemoryLifecycleHandler handles memory lifecycle API requests
type MemoryLifecycleHandler struct {
	lifecycleService *service.MemoryLifecycleService
}

// NewMemoryLifecycleHandler creates a new memory lifecycle handler
func NewMemoryLifecycleHandler(lifecycleService *service.MemoryLifecycleService) *MemoryLifecycleHandler {
	return &MemoryLifecycleHandler{
		lifecycleService: lifecycleService,
	}
}

// RegisterRoutes registers memory lifecycle routes
func (h *MemoryLifecycleHandler) RegisterRoutes(r *gin.RouterGroup) {
	lifecycle := r.Group("/workspaces/:id/memories")
	{
		lifecycle.GET("/stats", h.GetStats)
		lifecycle.GET("/export", h.ExportMemories)
		lifecycle.POST("/import", h.ImportMemories)
		lifecycle.POST("/cleanup", h.RunCleanup)
	}
}

// GetStats returns memory statistics for a workspace
// GET /api/workspaces/:id/memories/stats
func (h *MemoryLifecycleHandler) GetStats(c *gin.Context) {
	workspaceID := c.Param("id")

	stats, err := h.lifecycleService.GetWorkspaceStats(c.Request.Context(), workspaceID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, stats)
}

// ExportMemories exports all memories for a workspace
// GET /api/workspaces/:id/memories/export
func (h *MemoryLifecycleHandler) ExportMemories(c *gin.Context) {
	workspaceID := c.Param("id")
	includeStats := c.Query("include_stats") == "true"
	format := c.Query("format")

	if format == "file" {
		// Return as downloadable file
		jsonData, err := h.lifecycleService.ExportWorkspaceMemoriesJSON(c.Request.Context(), workspaceID, includeStats)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}

		c.Header("Content-Disposition", "attachment; filename=memories-"+workspaceID+".json")
		c.Header("Content-Type", "application/json")
		c.Data(http.StatusOK, "application/json", jsonData)
		return
	}

	// Return as JSON response
	export, err := h.lifecycleService.ExportWorkspaceMemories(c.Request.Context(), workspaceID, includeStats)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, export)
}

// ImportMemoriesRequest represents an import request
type ImportMemoriesRequest struct {
	Data              *service.MemoryExportData `json:"data"`
	OverwriteExisting bool                      `json:"overwrite_existing"`
	SkipDuplicates    bool                      `json:"skip_duplicates"`
	ResetAccessStats  bool                      `json:"reset_access_stats"`
}

// ImportMemories imports memories into a workspace
// POST /api/workspaces/:id/memories/import
func (h *MemoryLifecycleHandler) ImportMemories(c *gin.Context) {
	workspaceID := c.Param("id")

	// Check content type
	contentType := c.ContentType()

	var data *service.MemoryExportData
	var opts *service.ImportMemoriesOptions

	if contentType == "application/json" {
		// JSON body
		var req ImportMemoriesRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		data = req.Data
		opts = &service.ImportMemoriesOptions{
			OverwriteExisting: req.OverwriteExisting,
			SkipDuplicates:    req.SkipDuplicates,
			ResetAccessStats:  req.ResetAccessStats,
		}
	} else if contentType == "multipart/form-data" {
		// File upload
		file, _, err := c.Request.FormFile("file")
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "No file uploaded"})
			return
		}
		defer file.Close()

		jsonData, err := io.ReadAll(file)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Failed to read file"})
			return
		}

		result, err := h.lifecycleService.ImportWorkspaceMemoriesJSON(
			c.Request.Context(),
			workspaceID,
			jsonData,
			&service.ImportMemoriesOptions{
				SkipDuplicates:    c.PostForm("skip_duplicates") != "false",
				OverwriteExisting: c.PostForm("overwrite_existing") == "true",
				ResetAccessStats:  c.PostForm("reset_access_stats") != "false",
			},
		)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}

		c.JSON(http.StatusOK, result)
		return
	} else {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Unsupported content type"})
		return
	}

	if data == nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "No data provided"})
		return
	}

	result, err := h.lifecycleService.ImportWorkspaceMemories(c.Request.Context(), workspaceID, data, opts)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, result)
}

// RunCleanup manually triggers memory cleanup
// POST /api/workspaces/:id/memories/cleanup
func (h *MemoryLifecycleHandler) RunCleanup(c *gin.Context) {
	err := h.lifecycleService.RunCleanup(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "Cleanup completed"})
}
