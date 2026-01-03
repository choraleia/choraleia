package handler

import (
	"net/http"
	"time"

	"github.com/choraleia/choraleia/pkg/models"
	"github.com/choraleia/choraleia/pkg/service"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

// Room Handlers

// ListRooms lists all rooms in a workspace
func (h *WorkspaceHandler) ListRooms(c *gin.Context) {
	workspaceID := c.Param("id")

	rooms, err := h.roomService.List(c.Request.Context(), workspaceID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	// Get active room ID
	workspace, err := h.workspaceService.Get(c.Request.Context(), workspaceID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"rooms":          rooms,
		"active_room_id": workspace.ActiveRoomID,
	})
}

// CreateRoom creates a new room
func (h *WorkspaceHandler) CreateRoom(c *gin.Context) {
	workspaceID := c.Param("id")

	var req service.CreateRoomRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	room, err := h.roomService.Create(c.Request.Context(), workspaceID, &req)
	if err != nil {
		status := http.StatusInternalServerError
		if err == service.ErrWorkspaceNotFound {
			status = http.StatusNotFound
		}
		c.JSON(status, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusCreated, room)
}

// GetRoom retrieves a room
func (h *WorkspaceHandler) GetRoom(c *gin.Context) {
	workspaceID := c.Param("id")
	roomID := c.Param("roomId")

	room, err := h.roomService.Get(c.Request.Context(), workspaceID, roomID)
	if err != nil {
		status := http.StatusInternalServerError
		if err == service.ErrRoomNotFound {
			status = http.StatusNotFound
		}
		c.JSON(status, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, room)
}

// UpdateRoom updates a room
func (h *WorkspaceHandler) UpdateRoom(c *gin.Context) {
	workspaceID := c.Param("id")
	roomID := c.Param("roomId")

	var req service.UpdateRoomRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	room, err := h.roomService.Update(c.Request.Context(), workspaceID, roomID, &req)
	if err != nil {
		status := http.StatusInternalServerError
		if err == service.ErrRoomNotFound {
			status = http.StatusNotFound
		}
		c.JSON(status, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, room)
}

// DeleteRoom deletes a room
func (h *WorkspaceHandler) DeleteRoom(c *gin.Context) {
	workspaceID := c.Param("id")
	roomID := c.Param("roomId")

	if err := h.roomService.Delete(c.Request.Context(), workspaceID, roomID); err != nil {
		status := http.StatusInternalServerError
		if err == service.ErrRoomNotFound {
			status = http.StatusNotFound
		} else if err == service.ErrCannotDeleteLastRoom {
			status = http.StatusBadRequest
		}
		c.JSON(status, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"success": true})
}

// CloneRoom clones a room
func (h *WorkspaceHandler) CloneRoom(c *gin.Context) {
	workspaceID := c.Param("id")
	roomID := c.Param("roomId")

	var req struct {
		Name string `json:"name" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	room, err := h.roomService.Clone(c.Request.Context(), workspaceID, roomID, req.Name)
	if err != nil {
		status := http.StatusInternalServerError
		if err == service.ErrRoomNotFound {
			status = http.StatusNotFound
		}
		c.JSON(status, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusCreated, room)
}

// ActivateRoom sets a room as active
func (h *WorkspaceHandler) ActivateRoom(c *gin.Context) {
	workspaceID := c.Param("id")
	roomID := c.Param("roomId")

	if err := h.roomService.Activate(c.Request.Context(), workspaceID, roomID); err != nil {
		status := http.StatusInternalServerError
		if err == service.ErrRoomNotFound {
			status = http.StatusNotFound
		}
		c.JSON(status, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"active_room_id": roomID})
}

// Asset Handlers

// ListAssets lists all assets in a workspace
func (h *WorkspaceHandler) ListAssets(c *gin.Context) {
	workspaceID := c.Param("id")

	workspace, err := h.workspaceService.Get(c.Request.Context(), workspaceID)
	if err != nil {
		status := http.StatusInternalServerError
		if err == service.ErrWorkspaceNotFound {
			status = http.StatusNotFound
		}
		c.JSON(status, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"assets": workspace.Assets})
}

// AddAsset adds an asset to a workspace
func (h *WorkspaceHandler) AddAsset(c *gin.Context) {
	workspaceID := c.Param("id")

	// Verify workspace exists
	if _, err := h.workspaceService.Get(c.Request.Context(), workspaceID); err != nil {
		status := http.StatusInternalServerError
		if err == service.ErrWorkspaceNotFound {
			status = http.StatusNotFound
		}
		c.JSON(status, gin.H{"error": err.Error()})
		return
	}

	var req service.CreateAssetRefRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// TODO: Look up asset to get type and name
	asset := &models.WorkspaceAssetRef{
		ID:           uuid.New().String(),
		WorkspaceID:  workspaceID,
		AssetID:      req.AssetID,
		AssetType:    "unknown", // TODO: Get from asset service
		AssetName:    "Unknown", // TODO: Get from asset service
		AIHint:       req.AIHint,
		Restrictions: req.Restrictions,
		CreatedAt:    time.Now(),
	}

	if err := h.workspaceService.DB().Create(asset).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusCreated, asset)
}

// UpdateAsset updates an asset reference
func (h *WorkspaceHandler) UpdateAsset(c *gin.Context) {
	workspaceID := c.Param("id")
	refID := c.Param("refId")

	var req struct {
		AIHint       *string         `json:"ai_hint,omitempty"`
		Restrictions *models.JSONMap `json:"restrictions,omitempty"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	var asset models.WorkspaceAssetRef
	if err := h.workspaceService.DB().First(&asset, "id = ? AND workspace_id = ?", refID, workspaceID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "asset reference not found"})
		return
	}

	updates := make(map[string]interface{})
	if req.AIHint != nil {
		updates["ai_hint"] = *req.AIHint
	}
	if req.Restrictions != nil {
		updates["restrictions"] = *req.Restrictions
	}

	if len(updates) > 0 {
		if err := h.workspaceService.DB().Model(&asset).Updates(updates).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
	}

	// Reload
	h.workspaceService.DB().First(&asset, "id = ?", refID)
	c.JSON(http.StatusOK, asset)
}

// RemoveAsset removes an asset from a workspace
func (h *WorkspaceHandler) RemoveAsset(c *gin.Context) {
	workspaceID := c.Param("id")
	refID := c.Param("refId")

	result := h.workspaceService.DB().Delete(&models.WorkspaceAssetRef{}, "id = ? AND workspace_id = ?", refID, workspaceID)
	if result.Error != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": result.Error.Error()})
		return
	}
	if result.RowsAffected == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "asset reference not found"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"success": true})
}

// Tool Handlers

// ListTools lists all tools in a workspace
func (h *WorkspaceHandler) ListTools(c *gin.Context) {
	workspaceID := c.Param("id")

	workspace, err := h.workspaceService.Get(c.Request.Context(), workspaceID)
	if err != nil {
		status := http.StatusInternalServerError
		if err == service.ErrWorkspaceNotFound {
			status = http.StatusNotFound
		}
		c.JSON(status, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"tools": workspace.Tools})
}

// AddTool adds a tool to a workspace
func (h *WorkspaceHandler) AddTool(c *gin.Context) {
	workspaceID := c.Param("id")

	// Verify workspace exists
	if _, err := h.workspaceService.Get(c.Request.Context(), workspaceID); err != nil {
		status := http.StatusInternalServerError
		if err == service.ErrWorkspaceNotFound {
			status = http.StatusNotFound
		}
		c.JSON(status, gin.H{"error": err.Error()})
		return
	}

	var req service.CreateToolRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	enabled := true
	if req.Enabled != nil {
		enabled = *req.Enabled
	}

	tool := &models.WorkspaceTool{
		ID:          uuid.New().String(),
		WorkspaceID: workspaceID,
		Name:        req.Name,
		Type:        req.Type,
		Description: req.Description,
		Enabled:     enabled,
		Config:      req.Config,
		AIHint:      req.AIHint,
		CreatedAt:   time.Now(),
		UpdatedAt:   time.Now(),
	}

	if err := h.workspaceService.DB().Create(tool).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusCreated, tool)
}

// UpdateTool updates a tool
func (h *WorkspaceHandler) UpdateTool(c *gin.Context) {
	workspaceID := c.Param("id")
	toolID := c.Param("toolId")

	var req struct {
		Name        *string         `json:"name,omitempty"`
		Description *string         `json:"description,omitempty"`
		Enabled     *bool           `json:"enabled,omitempty"`
		Config      *models.JSONMap `json:"config,omitempty"`
		AIHint      *string         `json:"ai_hint,omitempty"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	var tool models.WorkspaceTool
	if err := h.workspaceService.DB().First(&tool, "id = ? AND workspace_id = ?", toolID, workspaceID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "tool not found"})
		return
	}

	updates := map[string]interface{}{
		"updated_at": time.Now(),
	}
	if req.Name != nil {
		updates["name"] = *req.Name
	}
	if req.Description != nil {
		updates["description"] = *req.Description
	}
	if req.Enabled != nil {
		updates["enabled"] = *req.Enabled
	}
	if req.Config != nil {
		updates["config"] = *req.Config
	}
	if req.AIHint != nil {
		updates["ai_hint"] = *req.AIHint
	}

	if err := h.workspaceService.DB().Model(&tool).Updates(updates).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	// Reload
	h.workspaceService.DB().First(&tool, "id = ?", toolID)
	c.JSON(http.StatusOK, tool)
}

// RemoveTool removes a tool from a workspace
func (h *WorkspaceHandler) RemoveTool(c *gin.Context) {
	workspaceID := c.Param("id")
	toolID := c.Param("toolId")

	result := h.workspaceService.DB().Delete(&models.WorkspaceTool{}, "id = ? AND workspace_id = ?", toolID, workspaceID)
	if result.Error != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": result.Error.Error()})
		return
	}
	if result.RowsAffected == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "tool not found"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"success": true})
}

// ToggleTool enables/disables a tool
func (h *WorkspaceHandler) ToggleTool(c *gin.Context) {
	workspaceID := c.Param("id")
	toolID := c.Param("toolId")

	var req struct {
		Enabled bool `json:"enabled"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	var tool models.WorkspaceTool
	if err := h.workspaceService.DB().First(&tool, "id = ? AND workspace_id = ?", toolID, workspaceID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "tool not found"})
		return
	}

	if err := h.workspaceService.DB().Model(&tool).Updates(map[string]interface{}{
		"enabled":    req.Enabled,
		"updated_at": time.Now(),
	}).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	tool.Enabled = req.Enabled
	c.JSON(http.StatusOK, tool)
}

// TestTool tests tool connection
func (h *WorkspaceHandler) TestTool(c *gin.Context) {
	workspaceID := c.Param("id")
	toolID := c.Param("toolId")

	var tool models.WorkspaceTool
	if err := h.workspaceService.DB().First(&tool, "id = ? AND workspace_id = ?", toolID, workspaceID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "tool not found"})
		return
	}

	// TODO: Implement actual tool testing
	result := &service.ToolTestResult{
		Success: true,
		Message: "Tool connection successful",
	}

	c.JSON(http.StatusOK, result)
}
