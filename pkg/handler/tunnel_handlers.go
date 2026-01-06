// filepath: /home/blue/codes/choraleia/pkg/handler/tunnel_handlers.go
package handler

import (
	"log/slog"
	"net/http"

	"github.com/choraleia/choraleia/pkg/service"
	"github.com/gin-gonic/gin"
)

// TunnelHandler handles tunnel-related HTTP requests
type TunnelHandler struct {
	tunnelService *service.TunnelService
	logger        *slog.Logger
}

// NewTunnelHandler creates a new tunnel handler
func NewTunnelHandler(tunnelService *service.TunnelService, logger *slog.Logger) *TunnelHandler {
	return &TunnelHandler{
		tunnelService: tunnelService,
		logger:        logger,
	}
}

// List returns all tunnels with their status
// GET /api/tunnels
func (h *TunnelHandler) List(c *gin.Context) {
	// Reload tunnels from assets to pick up any new configurations
	if err := h.tunnelService.LoadTunnelsFromAssets(); err != nil {
		h.logger.Warn("Failed to load tunnels from assets", "error", err)
	}

	tunnels, stats := h.tunnelService.GetTunnels()

	c.JSON(http.StatusOK, gin.H{
		"code": 200,
		"data": gin.H{
			"tunnels": tunnels,
			"stats":   stats,
		},
	})
}

// GetStats returns only tunnel statistics
// GET /api/tunnels/stats
func (h *TunnelHandler) GetStats(c *gin.Context) {
	// Reload tunnels from assets to pick up any new configurations
	if err := h.tunnelService.LoadTunnelsFromAssets(); err != nil {
		h.logger.Warn("Failed to load tunnels from assets", "error", err)
	}

	stats := h.tunnelService.GetStats()

	c.JSON(http.StatusOK, gin.H{
		"code": 200,
		"data": stats,
	})
}

// Start starts a specific tunnel
// POST /api/tunnels/:id/start
func (h *TunnelHandler) Start(c *gin.Context) {
	tunnelID := c.Param("id")
	if tunnelID == "" {
		c.JSON(http.StatusBadRequest, gin.H{
			"code":    400,
			"message": "tunnel ID is required",
		})
		return
	}

	// Reload tunnels from assets to ensure tunnel exists in memory
	if err := h.tunnelService.LoadTunnelsFromAssets(); err != nil {
		h.logger.Warn("Failed to load tunnels from assets", "error", err)
	}

	if err := h.tunnelService.StartTunnel(tunnelID); err != nil {
		h.logger.Error("Failed to start tunnel", "id", tunnelID, "error", err)
		c.JSON(http.StatusInternalServerError, gin.H{
			"code":    500,
			"message": err.Error(),
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"code":    200,
		"message": "tunnel started",
	})
}

// Stop stops a specific tunnel
// POST /api/tunnels/:id/stop
func (h *TunnelHandler) Stop(c *gin.Context) {
	tunnelID := c.Param("id")
	if tunnelID == "" {
		c.JSON(http.StatusBadRequest, gin.H{
			"code":    400,
			"message": "tunnel ID is required",
		})
		return
	}

	// Reload tunnels from assets to ensure tunnel exists in memory
	if err := h.tunnelService.LoadTunnelsFromAssets(); err != nil {
		h.logger.Warn("Failed to load tunnels from assets", "error", err)
	}

	if err := h.tunnelService.StopTunnel(tunnelID); err != nil {
		h.logger.Error("Failed to stop tunnel", "id", tunnelID, "error", err)
		c.JSON(http.StatusInternalServerError, gin.H{
			"code":    500,
			"message": err.Error(),
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"code":    200,
		"message": "tunnel stopped",
	})
}
