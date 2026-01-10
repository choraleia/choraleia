package handler

import (
	"context"
	"encoding/base64"
	"log/slog"
	"net/http"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/gorilla/websocket"

	"github.com/choraleia/choraleia/pkg/service"
	"github.com/choraleia/choraleia/pkg/utils"
)

// BrowserHandler handles browser-related HTTP and WebSocket requests
type BrowserHandler struct {
	browserService *service.BrowserService
	upgrader       websocket.Upgrader
	logger         *slog.Logger
}

// NewBrowserHandler creates a new browser handler
func NewBrowserHandler(browserService *service.BrowserService) *BrowserHandler {
	return &BrowserHandler{
		browserService: browserService,
		upgrader: websocket.Upgrader{
			CheckOrigin: func(r *http.Request) bool {
				return true // Allow all origins for development
			},
		},
		logger: utils.GetLogger(),
	}
}

// RegisterRoutes registers browser routes
func (h *BrowserHandler) RegisterRoutes(r *gin.RouterGroup) {
	browser := r.Group("/browser")
	{
		browser.GET("/ws", h.HandleWebSocket)
		browser.GET("/list/:conversationId", h.ListBrowsers)
		browser.GET("/screenshot/:browserId", h.GetScreenshot)
	}
}

// BrowserWSMessage represents a WebSocket message
type BrowserWSMessage struct {
	Type    string      `json:"type"`
	Payload interface{} `json:"payload"`
}

// HandleWebSocket handles WebSocket connections for browser state updates
func (h *BrowserHandler) HandleWebSocket(c *gin.Context) {
	conversationID := c.Query("conversation_id")
	if conversationID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "conversation_id required"})
		return
	}

	conn, err := h.upgrader.Upgrade(c.Writer, c.Request, nil)
	if err != nil {
		h.logger.Error("WebSocket upgrade failed", "error", err)
		return
	}
	defer conn.Close()

	var mu sync.Mutex
	closed := false

	// Send initial browser list
	browsers := h.browserService.ListBrowsers(conversationID)
	initialMsg := &BrowserWSMessage{
		Type:    "browser_list",
		Payload: browsers,
	}
	if err := conn.WriteJSON(initialMsg); err != nil {
		h.logger.Error("Failed to send initial browser list", "error", err)
		return
	}

	// Start screenshot streaming for active browsers
	stopScreenshot := make(chan struct{})
	go h.streamScreenshots(conversationID, conn, &mu, &closed, stopScreenshot)

	// Handle incoming messages (keep connection alive)
	for {
		_, _, err := conn.ReadMessage()
		if err != nil {
			mu.Lock()
			closed = true
			mu.Unlock()
			close(stopScreenshot)
			return
		}
	}
}

// streamScreenshots periodically sends screenshots for all browsers in a conversation
func (h *BrowserHandler) streamScreenshots(conversationID string, conn *websocket.Conn, mu *sync.Mutex, closed *bool, stop chan struct{}) {
	ticker := time.NewTicker(2 * time.Second)
	defer ticker.Stop()

	h.logger.Info("Starting screenshot stream", "conversationID", conversationID)

	var lastBrowserCount int
	var lastTabCounts = make(map[string]int)

	for {
		select {
		case <-stop:
			h.logger.Info("Stopping screenshot stream", "conversationID", conversationID)
			return
		case <-ticker.C:
			mu.Lock()
			if *closed {
				mu.Unlock()
				return
			}
			mu.Unlock()

			browsers := h.browserService.ListBrowsers(conversationID)

			// Check if browser list or tabs changed, send update if so
			browserCountChanged := len(browsers) != lastBrowserCount
			tabsChanged := false
			for _, browser := range browsers {
				if lastTabCounts[browser.ID] != len(browser.Tabs) {
					tabsChanged = true
					lastTabCounts[browser.ID] = len(browser.Tabs)
				}
			}

			if browserCountChanged || tabsChanged {
				lastBrowserCount = len(browsers)
				// Send updated browser list
				listMsg := &BrowserWSMessage{
					Type:    "browser_list",
					Payload: browsers,
				}
				mu.Lock()
				if !*closed {
					conn.WriteJSON(listMsg)
				}
				mu.Unlock()
			}

			// Send screenshots for ready browsers
			for _, browser := range browsers {
				if browser.Status != service.BrowserStatusReady {
					continue
				}

				// Take screenshot
				data, err := h.browserService.Screenshot(context.Background(), browser.ID, false)
				if err != nil {
					h.logger.Debug("Failed to take screenshot", "browserID", browser.ID, "error", err)
					continue
				}

				msg := &BrowserWSMessage{
					Type: "screenshot",
					Payload: map[string]interface{}{
						"browser_id": browser.ID,
						"data":       base64.StdEncoding.EncodeToString(data),
						"url":        browser.CurrentURL,
						"title":      browser.CurrentTitle,
						"tabs":       browser.Tabs,
						"active_tab": browser.ActiveTab,
					},
				}

				mu.Lock()
				if *closed {
					mu.Unlock()
					return
				}
				if err := conn.WriteJSON(msg); err != nil {
					h.logger.Debug("Failed to send screenshot", "browserID", browser.ID, "error", err)
				}
				mu.Unlock()
			}
		}
	}
}

// ListBrowsers returns all browsers for a conversation
func (h *BrowserHandler) ListBrowsers(c *gin.Context) {
	conversationID := c.Param("conversationId")
	browsers := h.browserService.ListBrowsers(conversationID)
	c.JSON(http.StatusOK, browsers)
}

// GetScreenshot returns a screenshot for a browser
func (h *BrowserHandler) GetScreenshot(c *gin.Context) {
	browserID := c.Param("browserId")
	fullPage := c.Query("full_page") == "true"

	data, err := h.browserService.Screenshot(c.Request.Context(), browserID, fullPage)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.Header("Content-Type", "image/png")
	c.Writer.Write(data)
}

// BrowserStateHandler returns a handler for browser state change notifications
func (h *BrowserHandler) BrowserStateHandler() func(browserID string, instance *service.BrowserInstance) {
	return func(browserID string, instance *service.BrowserInstance) {
		// This can be used to broadcast state changes via event system
		h.logger.Debug("Browser state changed",
			"browserID", browserID,
			"status", instance.Status,
			"conversationID", instance.ConversationID)
	}
}
