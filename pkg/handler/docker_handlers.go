package handler

import (
	"net/http"

	"log/slog"

	"github.com/choraleia/choraleia/pkg/models"
	"github.com/choraleia/choraleia/pkg/service"
	"github.com/choraleia/choraleia/pkg/utils"
	"github.com/gin-gonic/gin"
)

// DockerHandler provides HTTP handlers for Docker operations
type DockerHandler struct {
	assetService  *service.AssetService
	dockerService *service.DockerService
	logger        *slog.Logger
}

func NewDockerHandler(assetService *service.AssetService, dockerService *service.DockerService, logger *slog.Logger) *DockerHandler {
	return &DockerHandler{
		assetService:  assetService,
		dockerService: dockerService,
		logger:        logger,
	}
}

// ListContainers returns containers for a docker host asset
// GET /api/assets/:id/docker/containers?all=true
func (h *DockerHandler) ListContainers(c *gin.Context) {
	assetID := c.Param("id")
	showAll := c.Query("all") == "true"

	asset, err := h.assetService.GetAsset(assetID)
	if err != nil {
		h.logger.Warn("Asset not found", "assetId", assetID, "error", err)
		c.JSON(http.StatusNotFound, models.Response{Code: 404, Message: "Asset not found"})
		return
	}

	if asset.Type != models.AssetTypeDockerHost {
		c.JSON(http.StatusBadRequest, models.Response{Code: 400, Message: "Asset is not a Docker host"})
		return
	}

	containers, err := h.dockerService.ListContainers(c.Request.Context(), asset, showAll)
	if err != nil {
		h.logger.Error("Failed to list containers", "assetId", assetID, "error", err)
		c.JSON(http.StatusInternalServerError, models.Response{Code: 500, Message: err.Error()})
		return
	}

	c.JSON(http.StatusOK, models.Response{
		Code:    200,
		Message: "Success",
		Data:    map[string]interface{}{"containers": containers},
	})
}

// ContainerAction performs an action on a container (start, stop, restart)
// POST /api/assets/:id/docker/containers/:containerId/:action
func (h *DockerHandler) ContainerAction(c *gin.Context) {
	assetID := c.Param("id")
	containerID := c.Param("containerId")
	action := c.Param("action")

	asset, err := h.assetService.GetAsset(assetID)
	if err != nil {
		c.JSON(http.StatusNotFound, models.Response{Code: 404, Message: "Asset not found"})
		return
	}

	if asset.Type != models.AssetTypeDockerHost {
		c.JSON(http.StatusBadRequest, models.Response{Code: 400, Message: "Asset is not a Docker host"})
		return
	}

	var actionErr error
	switch action {
	case "start":
		actionErr = h.dockerService.StartContainer(c.Request.Context(), asset, containerID)
	case "stop":
		actionErr = h.dockerService.StopContainer(c.Request.Context(), asset, containerID)
	case "restart":
		actionErr = h.dockerService.RestartContainer(c.Request.Context(), asset, containerID)
	default:
		c.JSON(http.StatusBadRequest, models.Response{Code: 400, Message: "Invalid action: " + action})
		return
	}

	if actionErr != nil {
		h.logger.Error("Container action failed", "action", action, "containerId", containerID, "error", actionErr)
		c.JSON(http.StatusInternalServerError, models.Response{Code: 500, Message: actionErr.Error()})
		return
	}

	h.logger.Info("Container action performed", "action", action, "containerId", containerID, "assetId", assetID)
	c.JSON(http.StatusOK, models.Response{Code: 200, Message: "Success"})
}

// TestConnection tests connection to Docker daemon
// POST /api/assets/:id/docker/test
func (h *DockerHandler) TestConnection(c *gin.Context) {
	assetID := c.Param("id")

	asset, err := h.assetService.GetAsset(assetID)
	if err != nil {
		c.JSON(http.StatusNotFound, models.Response{Code: 404, Message: "Asset not found"})
		return
	}

	if asset.Type != models.AssetTypeDockerHost {
		c.JSON(http.StatusBadRequest, models.Response{Code: 400, Message: "Asset is not a Docker host"})
		return
	}

	info, err := h.dockerService.TestConnection(c.Request.Context(), asset)
	if err != nil {
		c.JSON(http.StatusOK, models.Response{
			Code:    500,
			Message: err.Error(),
			Data:    map[string]interface{}{"success": false},
		})
		return
	}

	c.JSON(http.StatusOK, models.Response{
		Code:    200,
		Message: "Connection successful",
		Data: map[string]interface{}{
			"success":    true,
			"version":    info.Version,
			"containers": info.ContainerCount,
		},
	})
}

// TestConnectionByConfig tests Docker connection without saving asset first
// POST /api/docker/test
func (h *DockerHandler) TestConnectionByConfig(c *gin.Context) {
	var req struct {
		ConnectionType string `json:"connection_type"`
		SSHAssetID     string `json:"ssh_asset_id,omitempty"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, models.Response{Code: 400, Message: "Invalid request"})
		return
	}

	// Create a temporary asset for testing
	tempAsset := &models.Asset{
		Type: models.AssetTypeDockerHost,
		Config: map[string]interface{}{
			"connection_type": req.ConnectionType,
			"ssh_asset_id":    req.SSHAssetID,
		},
	}

	info, err := h.dockerService.TestConnection(c.Request.Context(), tempAsset)
	if err != nil {
		c.JSON(http.StatusOK, models.Response{
			Code:    500,
			Message: err.Error(),
			Data:    map[string]interface{}{"success": false},
		})
		return
	}

	c.JSON(http.StatusOK, models.Response{
		Code:    200,
		Message: "Connection successful",
		Data: map[string]interface{}{
			"success":    true,
			"version":    info.Version,
			"containers": info.ContainerCount,
		},
	})
}

// GetDockerHandler is a helper to create handler with default logger
func GetDockerHandler(assetService *service.AssetService, dockerService *service.DockerService) *DockerHandler {
	return NewDockerHandler(assetService, dockerService, utils.GetLogger())
}
