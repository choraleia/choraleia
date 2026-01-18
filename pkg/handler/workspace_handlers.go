package handler

import (
	"net/http"

	"github.com/choraleia/choraleia/pkg/models"
	"github.com/choraleia/choraleia/pkg/service"
	"github.com/gin-gonic/gin"
)

// WorkspaceHandler handles workspace API requests
type WorkspaceHandler struct {
	workspaceService *service.WorkspaceService
	roomService      *service.RoomService
}

// NewWorkspaceHandler creates a new WorkspaceHandler
func NewWorkspaceHandler(ws *service.WorkspaceService) *WorkspaceHandler {
	return &WorkspaceHandler{
		workspaceService: ws,
		roomService:      service.NewRoomService(ws),
	}
}

// RegisterRoutes registers workspace routes
func (h *WorkspaceHandler) RegisterRoutes(r *gin.RouterGroup) {
	workspaces := r.Group("/workspaces")
	{
		workspaces.GET("", h.List)
		workspaces.POST("", h.Create)
		workspaces.GET("/:id", h.Get)
		workspaces.PUT("/:id", h.Update)
		workspaces.DELETE("/:id", h.Delete)
		workspaces.POST("/:id/clone", h.Clone)

		// Lifecycle
		workspaces.POST("/:id/start", h.Start)
		workspaces.POST("/:id/stop", h.Stop)
		workspaces.GET("/:id/status", h.GetStatus)

		// Rooms
		workspaces.GET("/:id/rooms", h.ListRooms)
		workspaces.POST("/:id/rooms", h.CreateRoom)
		workspaces.GET("/:id/rooms/:roomId", h.GetRoom)
		workspaces.PUT("/:id/rooms/:roomId", h.UpdateRoom)
		workspaces.DELETE("/:id/rooms/:roomId", h.DeleteRoom)
		workspaces.POST("/:id/rooms/:roomId/clone", h.CloneRoom)
		workspaces.POST("/:id/rooms/:roomId/activate", h.ActivateRoom)

		// Assets
		workspaces.GET("/:id/assets", h.ListAssets)
		workspaces.POST("/:id/assets", h.AddAsset)
		workspaces.PUT("/:id/assets/:refId", h.UpdateAsset)
		workspaces.DELETE("/:id/assets/:refId", h.RemoveAsset)

		// Tools
		workspaces.GET("/:id/tools", h.ListTools)
		workspaces.POST("/:id/tools", h.AddTool)
		workspaces.PUT("/:id/tools/:toolId", h.UpdateTool)
		workspaces.DELETE("/:id/tools/:toolId", h.RemoveTool)
		workspaces.POST("/:id/tools/:toolId/toggle", h.ToggleTool)
		workspaces.POST("/:id/tools/:toolId/test", h.TestTool)

		// Agents
		workspaces.GET("/:id/agents", h.ListAgents)
		workspaces.POST("/:id/agents", h.CreateAgent)
		workspaces.GET("/:id/agents/:agentId", h.GetAgent)
		workspaces.PUT("/:id/agents/:agentId", h.UpdateAgent)
		workspaces.DELETE("/:id/agents/:agentId", h.DeleteAgent)
		workspaces.POST("/:id/agents/:agentId/toggle", h.ToggleAgent)
	}
}

// List lists all workspaces
// @Summary List workspaces
// @Tags workspaces
// @Produce json
// @Param status query string false "Filter by status"
// @Success 200 {object} map[string][]models.WorkspaceListItem
// @Router /workspaces [get]
func (h *WorkspaceHandler) List(c *gin.Context) {
	var filter service.WorkspaceFilter
	if status := c.Query("status"); status != "" {
		s := models.WorkspaceStatus(status)
		filter.Status = &s
	}

	workspaces, err := h.workspaceService.List(c.Request.Context(), &filter)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"workspaces": workspaces})
}

// Create creates a new workspace
// @Summary Create workspace
// @Tags workspaces
// @Accept json
// @Produce json
// @Param request body service.CreateWorkspaceRequest true "Workspace configuration"
// @Success 201 {object} models.Workspace
// @Router /workspaces [post]
func (h *WorkspaceHandler) Create(c *gin.Context) {
	var req service.CreateWorkspaceRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	workspace, err := h.workspaceService.Create(c.Request.Context(), &req)
	if err != nil {
		status := http.StatusInternalServerError
		if err == service.ErrWorkspaceNameExists || err == service.ErrWorkspaceNameInvalid {
			status = http.StatusBadRequest
		}
		c.JSON(status, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusCreated, workspace)
}

// Get retrieves a workspace
// @Summary Get workspace
// @Tags workspaces
// @Produce json
// @Param id path string true "Workspace ID"
// @Success 200 {object} models.Workspace
// @Router /workspaces/{id} [get]
func (h *WorkspaceHandler) Get(c *gin.Context) {
	id := c.Param("id")

	workspace, err := h.workspaceService.Get(c.Request.Context(), id)
	if err != nil {
		if err == service.ErrWorkspaceNotFound {
			c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, workspace)
}

// Update updates a workspace
// @Summary Update workspace
// @Tags workspaces
// @Accept json
// @Produce json
// @Param id path string true "Workspace ID"
// @Param request body service.UpdateWorkspaceRequest true "Update data"
// @Success 200 {object} models.Workspace
// @Router /workspaces/{id} [put]
func (h *WorkspaceHandler) Update(c *gin.Context) {
	id := c.Param("id")

	var req service.UpdateWorkspaceRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	workspace, err := h.workspaceService.Update(c.Request.Context(), id, &req)
	if err != nil {
		status := http.StatusInternalServerError
		if err == service.ErrWorkspaceNotFound {
			status = http.StatusNotFound
		} else if err == service.ErrWorkspaceNameExists || err == service.ErrWorkspaceNameInvalid {
			status = http.StatusBadRequest
		}
		c.JSON(status, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, workspace)
}

// Delete deletes a workspace
// @Summary Delete workspace
// @Tags workspaces
// @Param id path string true "Workspace ID"
// @Param force query bool false "Force delete"
// @Success 200 {object} map[string]bool
// @Router /workspaces/{id} [delete]
func (h *WorkspaceHandler) Delete(c *gin.Context) {
	id := c.Param("id")
	force := c.Query("force") == "true"

	if err := h.workspaceService.Delete(c.Request.Context(), id, force); err != nil {
		status := http.StatusInternalServerError
		if err == service.ErrWorkspaceNotFound {
			status = http.StatusNotFound
		} else if err == service.ErrWorkspaceRunning {
			status = http.StatusConflict
		}
		c.JSON(status, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"success": true})
}

// Clone clones a workspace
// @Summary Clone workspace
// @Tags workspaces
// @Accept json
// @Produce json
// @Param id path string true "Workspace ID"
// @Param request body map[string]string true "Clone data with new name"
// @Success 201 {object} models.Workspace
// @Router /workspaces/{id}/clone [post]
func (h *WorkspaceHandler) Clone(c *gin.Context) {
	id := c.Param("id")

	var req struct {
		Name string `json:"name" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	workspace, err := h.workspaceService.Clone(c.Request.Context(), id, req.Name)
	if err != nil {
		status := http.StatusInternalServerError
		if err == service.ErrWorkspaceNotFound {
			status = http.StatusNotFound
		} else if err == service.ErrWorkspaceNameExists || err == service.ErrWorkspaceNameInvalid {
			status = http.StatusBadRequest
		}
		c.JSON(status, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusCreated, workspace)
}

// Start starts a workspace
// @Summary Start workspace
// @Tags workspaces
// @Param id path string true "Workspace ID"
// @Success 202 {object} map[string]string
// @Router /workspaces/{id}/start [post]
func (h *WorkspaceHandler) Start(c *gin.Context) {
	id := c.Param("id")

	if err := h.workspaceService.Start(c.Request.Context(), id); err != nil {
		status := http.StatusInternalServerError
		if err == service.ErrWorkspaceNotFound {
			status = http.StatusNotFound
		}
		c.JSON(status, gin.H{"error": err.Error()})
		return
	}

	// Return 202 Accepted - operation is async
	c.JSON(http.StatusAccepted, gin.H{
		"status":  "starting",
		"message": "Workspace start initiated. Query /status for progress.",
	})
}

// Stop stops a workspace
// @Summary Stop workspace
// @Tags workspaces
// @Param id path string true "Workspace ID"
// @Param force query bool false "Force stop"
// @Success 202 {object} map[string]string
// @Router /workspaces/{id}/stop [post]
func (h *WorkspaceHandler) Stop(c *gin.Context) {
	id := c.Param("id")
	force := c.Query("force") == "true"

	if err := h.workspaceService.Stop(c.Request.Context(), id, force); err != nil {
		status := http.StatusInternalServerError
		if err == service.ErrWorkspaceNotFound {
			status = http.StatusNotFound
		}
		c.JSON(status, gin.H{"error": err.Error()})
		return
	}

	// Return 202 Accepted - operation is async
	c.JSON(http.StatusAccepted, gin.H{
		"status":  "stopping",
		"message": "Workspace stop initiated. Query /status for progress.",
	})
}

// GetStatus gets workspace status
// @Summary Get workspace status
// @Tags workspaces
// @Param id path string true "Workspace ID"
// @Success 200 {object} service.WorkspaceStatusResponse
// @Router /workspaces/{id}/status [get]
func (h *WorkspaceHandler) GetStatus(c *gin.Context) {
	id := c.Param("id")

	status, err := h.workspaceService.GetStatus(c.Request.Context(), id)
	if err != nil {
		statusCode := http.StatusInternalServerError
		if err == service.ErrWorkspaceNotFound {
			statusCode = http.StatusNotFound
		}
		c.JSON(statusCode, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, status)
}
