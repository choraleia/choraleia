package handler

import (
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/imliuda/omniterm/pkg/models"
	"github.com/imliuda/omniterm/pkg/service"
	"log/slog"
)

// AssetHandler provides HTTP handlers for asset operations
type AssetHandler struct {
	Svc    *service.AssetService
	Logger *slog.Logger
}

func NewAssetHandler(svc *service.AssetService, logger *slog.Logger) *AssetHandler {
	return &AssetHandler{Svc: svc, Logger: logger}
}

func (h *AssetHandler) Create(c *gin.Context) {
	var req models.CreateAssetRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		h.Logger.Warn("Invalid create asset request", "error", err, "clientIP", c.ClientIP())
		c.JSON(http.StatusBadRequest, models.Response{Code: 400, Message: "Invalid request parameters: " + err.Error()})
		return
	}
	asset, err := h.Svc.CreateAsset(&req)
	if err != nil {
		h.Logger.Error("Failed to create asset", "name", req.Name, "type", req.Type, "error", err)
		c.JSON(http.StatusBadRequest, models.Response{Code: 400, Message: err.Error()})
		return
	}
	h.Logger.Info("Asset created via API", "assetId", asset.ID, "name", asset.Name, "type", asset.Type, "clientIP", c.ClientIP())
	c.JSON(http.StatusCreated, models.Response{Code: 200, Message: "Created successfully", Data: asset})
}

func (h *AssetHandler) List(c *gin.Context) {
	assetType := c.Query("type")
	search := c.Query("search")
	tagsStr := c.Query("tags")
	var tags []string
	if tagsStr != "" {
		tags = strings.Split(tagsStr, ",")
	}
	assets, err := h.Svc.ListAssets(assetType, tags, search)
	if err != nil {
		h.Logger.Error("Failed to list assets", "assetType", assetType, "search", search, "tags", tags, "error", err)
		c.JSON(http.StatusInternalServerError, models.Response{Code: 500, Message: err.Error()})
		return
	}
	h.Logger.Debug("Assets listed via API", "count", len(assets), "assetType", assetType, "search", search, "clientIP", c.ClientIP())
	c.JSON(http.StatusOK, models.Response{Code: 200, Message: "Retrieved successfully", Data: models.AssetListResponse{Assets: convertToAssetSlice(assets), Total: len(assets)}})
}

func (h *AssetHandler) Get(c *gin.Context) {
	id := c.Param("id")
	asset, err := h.Svc.GetAsset(id)
	if err != nil {
		h.Logger.Warn("Asset not found via API", "assetId", id, "clientIP", c.ClientIP())
		c.JSON(http.StatusNotFound, models.Response{Code: 404, Message: err.Error()})
		return
	}
	h.Logger.Debug("Asset retrieved via API", "assetId", id, "name", asset.Name, "clientIP", c.ClientIP())
	c.JSON(http.StatusOK, models.Response{Code: 200, Message: "Retrieved successfully", Data: asset})
}

func (h *AssetHandler) Update(c *gin.Context) {
	id := c.Param("id")
	var req models.UpdateAssetRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		h.Logger.Warn("Invalid update asset request", "assetId", id, "error", err, "clientIP", c.ClientIP())
		c.JSON(http.StatusBadRequest, models.Response{Code: 400, Message: "Invalid request parameters: " + err.Error()})
		return
	}
	asset, err := h.Svc.UpdateAsset(id, &req)
	if err != nil {
		h.Logger.Error("Failed to update asset", "assetId", id, "error", err, "clientIP", c.ClientIP())
		c.JSON(http.StatusBadRequest, models.Response{Code: 400, Message: err.Error()})
		return
	}
	h.Logger.Info("Asset updated via API", "assetId", id, "name", asset.Name, "clientIP", c.ClientIP())
	c.JSON(http.StatusOK, models.Response{Code: 200, Message: "Updated successfully", Data: asset})
}

func (h *AssetHandler) Delete(c *gin.Context) {
	id := c.Param("id")
	if err := h.Svc.DeleteAsset(id); err != nil {
		h.Logger.Error("Failed to delete asset", "assetId", id, "error", err, "clientIP", c.ClientIP())
		c.JSON(http.StatusNotFound, models.Response{Code: 404, Message: err.Error()})
		return
	}
	h.Logger.Info("Asset deleted via API", "assetId", id, "clientIP", c.ClientIP())
	c.JSON(http.StatusOK, models.Response{Code: 200, Message: "Deleted successfully"})
}

func (h *AssetHandler) ImportSSH(c *gin.Context) {
	count, err := h.Svc.ImportFromSSHConfig()
	if err != nil {
		h.Logger.Error("Failed to import SSH config", "error", err, "clientIP", c.ClientIP())
		c.JSON(http.StatusBadRequest, models.Response{Code: 400, Message: err.Error()})
		return
	}
	h.Logger.Info("SSH config imported via API", "importedCount", count, "clientIP", c.ClientIP())
	c.JSON(http.StatusOK, models.Response{Code: 200, Message: "Import successful", Data: map[string]interface{}{"imported_count": count}})
}

func (h *AssetHandler) ParseSSH(c *gin.Context) {
	hosts, err := h.Svc.ParseSSHConfig()
	if err != nil {
		h.Logger.Error("Failed to parse SSH config", "error", err, "clientIP", c.ClientIP())
		c.JSON(http.StatusBadRequest, models.Response{Code: 400, Message: err.Error()})
		return
	}
	h.Logger.Debug("SSH config parsed via API", "hostsCount", len(hosts), "clientIP", c.ClientIP())
	c.JSON(http.StatusOK, models.Response{Code: 200, Message: "Parsing successful", Data: hosts})
}

func (h *AssetHandler) Move(c *gin.Context) {
	id := c.Param("id")
	var req models.MoveAssetRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		h.Logger.Warn("Invalid move asset request", "assetId", id, "error", err, "clientIP", c.ClientIP())
		c.JSON(http.StatusBadRequest, models.Response{Code: 400, Message: "Invalid request parameters: " + err.Error()})
		return
	}
	asset, err := h.Svc.MoveAsset(id, &req)
	if err != nil {
		h.Logger.Error("Failed to move asset", "assetId", id, "error", err, "clientIP", c.ClientIP())
		c.JSON(http.StatusBadRequest, models.Response{Code: 400, Message: err.Error()})
		return
	}
	newParent := "root"
	if req.NewParentID != nil {
		newParent = *req.NewParentID
	}
	h.Logger.Info("Asset moved via API", "assetId", id, "newParent", newParent, "position", strings.ToLower(req.Position), "clientIP", c.ClientIP())
	c.JSON(http.StatusOK, models.Response{Code: 200, Message: "Moved successfully", Data: asset})
}

func (h *AssetHandler) ListSSHKeys(c *gin.Context) {
	keys, err := h.Svc.ListSSHKeys()
	if err != nil {
		h.Logger.Error("Failed to list SSH keys", "error", err, "clientIP", c.ClientIP())
		c.JSON(http.StatusInternalServerError, models.Response{Code: 500, Message: err.Error()})
		return
	}
	h.Logger.Debug("SSH keys listed via API", "count", len(keys), "clientIP", c.ClientIP())
	c.JSON(http.StatusOK, models.Response{Code: 200, Message: "Retrieved successfully", Data: map[string]interface{}{"keys": keys}})
}

func (h *AssetHandler) InspectSSHKey(c *gin.Context) {
	path := c.Query("path")
	if path == "" {
		c.JSON(http.StatusBadRequest, models.Response{Code: 400, Message: "path query param required"})
		return
	}
	info, err := h.Svc.InspectSSHKey(path)
	if err != nil {
		h.Logger.Warn("Failed to inspect SSH key", "path", path, "error", err, "clientIP", c.ClientIP())
		c.JSON(http.StatusNotFound, models.Response{Code: 404, Message: err.Error()})
		return
	}
	c.JSON(http.StatusOK, models.Response{Code: 200, Message: "OK", Data: info})
}

func convertToAssetSlice(assets []*models.Asset) []models.Asset {
	res := make([]models.Asset, len(assets))
	for i, a := range assets {
		res[i] = *a
	}
	return res
}
