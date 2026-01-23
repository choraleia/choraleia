// Memory optimization API handlers
package handler

import (
	"net/http"
	"strconv"

	"github.com/choraleia/choraleia/pkg/service"
	"github.com/gin-gonic/gin"
)

// MemoryOptimizationHandler handles memory optimization API requests
type MemoryOptimizationHandler struct {
	optimizationService *service.MemoryOptimizationService
}

// NewMemoryOptimizationHandler creates a new memory optimization handler
func NewMemoryOptimizationHandler(optimizationService *service.MemoryOptimizationService) *MemoryOptimizationHandler {
	return &MemoryOptimizationHandler{
		optimizationService: optimizationService,
	}
}

// RegisterRoutes registers memory optimization routes
func (h *MemoryOptimizationHandler) RegisterRoutes(r *gin.RouterGroup) {
	opt := r.Group("/workspaces/:id/memories")
	{
		// Deduplication & Merging
		opt.GET("/duplicates", h.FindDuplicates)
		opt.POST("/merge", h.MergeMemories)
		opt.POST("/auto-merge", h.AutoMerge)

		// Priority adjustment
		opt.POST("/adjust-priorities", h.AdjustPriorities)

		// Visualization
		opt.GET("/graph", h.GetMemoryGraph)

		// Insights
		opt.GET("/insights", h.GetInsights)
	}
}

// FindDuplicates finds groups of similar memories
// GET /api/workspaces/:id/memories/duplicates
func (h *MemoryOptimizationHandler) FindDuplicates(c *gin.Context) {
	workspaceID := c.Param("id")

	duplicates, err := h.optimizationService.FindDuplicates(c.Request.Context(), workspaceID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"groups": duplicates,
		"count":  len(duplicates),
	})
}

// MergeMemories merges multiple memories into one
// POST /api/workspaces/:id/memories/merge
func (h *MemoryOptimizationHandler) MergeMemories(c *gin.Context) {
	workspaceID := c.Param("id")

	var req service.MergeMemoriesRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	result, err := h.optimizationService.MergeMemories(c.Request.Context(), workspaceID, &req)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, result)
}

// AutoMerge automatically finds and merges duplicate memories
// POST /api/workspaces/:id/memories/auto-merge
func (h *MemoryOptimizationHandler) AutoMerge(c *gin.Context) {
	workspaceID := c.Param("id")

	result, err := h.optimizationService.AutoMerge(c.Request.Context(), workspaceID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, result)
}

// AdjustPriorities adjusts memory priorities based on access patterns
// POST /api/workspaces/:id/memories/adjust-priorities
func (h *MemoryOptimizationHandler) AdjustPriorities(c *gin.Context) {
	workspaceID := c.Param("id")

	result, err := h.optimizationService.AdjustPriorities(c.Request.Context(), workspaceID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, result)
}

// GetMemoryGraph generates a graph representation of memories
// GET /api/workspaces/:id/memories/graph
func (h *MemoryOptimizationHandler) GetMemoryGraph(c *gin.Context) {
	workspaceID := c.Param("id")

	opts := &service.MemoryGraphOptions{
		MaxNodes:            100,
		IncludeSimilarities: true,
		SimilarityThreshold: 0.7,
	}

	// Parse query parameters
	if maxNodes := c.Query("max_nodes"); maxNodes != "" {
		if n, err := strconv.Atoi(maxNodes); err == nil && n > 0 {
			opts.MaxNodes = n
		}
	}
	if threshold := c.Query("similarity_threshold"); threshold != "" {
		if t, err := strconv.ParseFloat(threshold, 64); err == nil && t >= 0 && t <= 1 {
			opts.SimilarityThreshold = t
		}
	}
	if c.Query("include_similarities") == "false" {
		opts.IncludeSimilarities = false
	}
	if filterType := c.Query("type"); filterType != "" {
		opts.FilterType = filterType
	}
	if filterCategory := c.Query("category"); filterCategory != "" {
		opts.FilterCategory = filterCategory
	}

	graph, err := h.optimizationService.GetMemoryGraph(c.Request.Context(), workspaceID, opts)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, graph)
}

// GetInsights provides analysis insights about memories
// GET /api/workspaces/:id/memories/insights
func (h *MemoryOptimizationHandler) GetInsights(c *gin.Context) {
	workspaceID := c.Param("id")

	insights, err := h.optimizationService.GetInsights(c.Request.Context(), workspaceID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, insights)
}
