package handler

import (
	"github.com/gin-gonic/gin"
	"github.com/imliuda/omniterm/pkg/models"
	"github.com/imliuda/omniterm/pkg/service"
	"log/slog"
	"net/http"
)

// QuickCmdHandler provides HTTP handlers for quick command operations
type QuickCmdHandler struct {
	Svc    *service.QuickCommandService
	Logger *slog.Logger
}

func NewQuickCmdHandler(svc *service.QuickCommandService, logger *slog.Logger) *QuickCmdHandler {
	return &QuickCmdHandler{Svc: svc, Logger: logger}
}

// List handles listing all quick commands
func (h *QuickCmdHandler) List(c *gin.Context) {
	cmds, err := h.Svc.List()
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.Response{Code: 500, Message: err.Error()})
		return
	}
	resp := make([]models.QuickCommand, 0, len(cmds))
	for _, cc := range cmds {
		resp = append(resp, *cc)
	}
	c.JSON(http.StatusOK, models.Response{Code: 200, Message: "OK", Data: models.QuickCommandListResponse{Commands: resp, Total: len(resp)}})
}

// Get handles retrieving a single quick command
func (h *QuickCmdHandler) Get(c *gin.Context) {
	id := c.Param("id")
	cc, err := h.Svc.Get(id)
	if err != nil {
		c.JSON(http.StatusNotFound, models.Response{Code: 404, Message: err.Error()})
		return
	}
	c.JSON(http.StatusOK, models.Response{Code: 200, Message: "OK", Data: cc})
}

// Create handles adding a new quick command
func (h *QuickCmdHandler) Create(c *gin.Context) {
	var req models.CreateQuickCommandRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, models.Response{Code: 400, Message: "Invalid request: " + err.Error()})
		return
	}
	cc, err := h.Svc.Create(&req)
	if err != nil {
		c.JSON(http.StatusBadRequest, models.Response{Code: 400, Message: err.Error()})
		return
	}
	c.JSON(http.StatusCreated, models.Response{Code: 200, Message: "Created", Data: cc})
}

// Update handles modifying an existing quick command
func (h *QuickCmdHandler) Update(c *gin.Context) {
	id := c.Param("id")
	var req models.UpdateQuickCommandRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, models.Response{Code: 400, Message: "Invalid request: " + err.Error()})
		return
	}
	cc, err := h.Svc.Update(id, &req)
	if err != nil {
		c.JSON(http.StatusBadRequest, models.Response{Code: 400, Message: err.Error()})
		return
	}
	c.JSON(http.StatusOK, models.Response{Code: 200, Message: "Updated", Data: cc})
}

// Delete handles removing a quick command
func (h *QuickCmdHandler) Delete(c *gin.Context) {
	id := c.Param("id")
	if err := h.Svc.Delete(id); err != nil {
		c.JSON(http.StatusNotFound, models.Response{Code: 404, Message: err.Error()})
		return
	}
	c.JSON(http.StatusOK, models.Response{Code: 200, Message: "Deleted"})
}

// Reorder handles changing the order of quick commands
func (h *QuickCmdHandler) Reorder(c *gin.Context) {
	var req models.ReorderQuickCommandsRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, models.Response{Code: 400, Message: "Invalid request: " + err.Error()})
		return
	}
	cmds, err := h.Svc.Reorder(req.IDs)
	if err != nil {
		c.JSON(http.StatusBadRequest, models.Response{Code: 400, Message: err.Error()})
		return
	}
	resp := make([]models.QuickCommand, 0, len(cmds))
	for _, cc := range cmds {
		resp = append(resp, *cc)
	}
	c.JSON(http.StatusOK, models.Response{Code: 200, Message: "Reordered", Data: models.QuickCommandListResponse{Commands: resp, Total: len(resp)}})
}
