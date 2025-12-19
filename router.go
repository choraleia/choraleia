package main

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/gorilla/websocket"
	"github.com/imliuda/omniterm/pkg/handler"
	"github.com/imliuda/omniterm/pkg/models"
	"github.com/imliuda/omniterm/pkg/service"
	"github.com/imliuda/omniterm/pkg/utils"
)

type Server struct {
	ginEngine *gin.Engine
	upgrader  *websocket.Upgrader
	logger    *slog.Logger
	port      int
}

func NewServer() *Server {
	ginEngine := gin.New()
	ginEngine.Use(gin.Recovery())

	// CORS middleware: allow Wails dev origins (wails://localhost:*) and common localhost origins.
	// Note: if you don't need cookies/credentials, keep Allow-Credentials off.
	ginEngine.Use(func(c *gin.Context) {
		origin := c.Request.Header.Get("Origin")

		// If there's no Origin header, it's not a browser CORS request.
		if origin != "" {
			allowed := false

			// Allow Wails dev scheme.
			if strings.HasPrefix(origin, "wails://localhost") || strings.HasPrefix(origin, "wails://127.0.0.1") {
				allowed = true
			}

			// Allow typical localhost dev origins.
			if strings.HasPrefix(origin, "http://localhost") ||
				strings.HasPrefix(origin, "http://127.0.0.1") ||
				strings.HasPrefix(origin, "https://localhost") ||
				strings.HasPrefix(origin, "https://127.0.0.1") {
				allowed = true
			}

			if allowed {
				// Must echo the Origin when Origin is a custom scheme (like wails://) to satisfy browsers.
				c.Header("Access-Control-Allow-Origin", origin)
				c.Header("Vary", "Origin")
				c.Header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
				c.Header("Access-Control-Allow-Headers", "Origin, Content-Type, Accept, Authorization")
			} else {
				// Reject unknown origins.
				c.AbortWithStatus(http.StatusForbidden)
				return
			}
		}

		if c.Request.Method == "OPTIONS" {
			c.AbortWithStatus(http.StatusNoContent)
			return
		}

		c.Next()
	})

	// Enable static resource middleware only in headless build (non-GUI mode)
	attachStatic(ginEngine)

	upgrader := &websocket.Upgrader{
		ReadBufferSize:  1024,
		WriteBufferSize: 1024,
		CheckOrigin: func(r *http.Request) bool {
			return true
		},
	}

	server := &Server{
		ginEngine: ginEngine,
		upgrader:  upgrader,
		logger:    utils.GetLogger(),
		port:      0,
	}

	server.SetupRoutes()

	return server
}

func (s *Server) Start(ctx context.Context) error {
	// Read port from environment variable OMNITERM_PORT, default to 8088 if unset or invalid
	port := 8088
	if v := os.Getenv("OMNITERM_PORT"); v != "" {
		if p, err := strconv.Atoi(v); err == nil && p > 0 && p <= 65535 {
			port = p
		} else {
			s.logger.Warn("Invalid OMNITERM_PORT value, falling back to default", "value", v)
		}
	}

	addr := fmt.Sprintf(":%d", port)
	srv := &http.Server{Addr: addr, Handler: s.ginEngine}

	// Attempt to listen on port first; if occupied return error immediately
	ln, err := net.Listen("tcp", srv.Addr)
	if err != nil {
		return err
	}

	// Record the actual port (useful if we ever switch to :0).
	if tcpAddr, ok := ln.Addr().(*net.TCPAddr); ok {
		s.port = tcpAddr.Port
	} else {
		s.port = port
	}

	errChan := make(chan error, 1)
	go func() {
		errChan <- srv.Serve(ln)
	}()

	// Listen for context cancellation for graceful shutdown
	go func() {
		<-ctx.Done()
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = srv.Shutdown(shutdownCtx)
	}()

	// Non-blocking: if startup fails immediately return error; otherwise return nil to let main continue
	select {
	case err := <-errChan:
		if err != nil && !errors.Is(err, http.ErrServerClosed) {
			return err
		}
	default:
	}
	return nil
}

func (s *Server) SetupRoutes() {
	// Create asset service instance
	assetService := service.NewAssetService()

	// Get chat store service instance
	chatStoreService, err := service.NewChatStore()
	if err != nil {
		s.logger.Error("Failed to get chat service", "error", err)
		os.Exit(1)
	}

	// Create model service instance
	modelService := service.NewModelService()

	// Create AI Chat service instance
	agentService := service.NewAIAgentService(chatStoreService, modelService)

	// Create terminal service instance
	terminalService := service.NewTerminalService(assetService)

	// Create quick command service instance
	quickCmdService := service.NewQuickCommandService()

	assetHandler := handler.NewAssetHandler(assetService, s.logger)
	quickCmdHandler := handler.NewQuickCmdHandler(quickCmdService, s.logger)

	// Terminal connection routes
	// /terminal
	termGroups := s.ginEngine.Group("/terminal")
	termGroups.GET("connect/:assetId", terminalService.RunTerminal)

	// API group
	// /api
	apiGroup := s.ginEngine.Group("/api")

	// Runtime info (for GUI/wails:// and headless clients to discover correct base URLs)
	apiGroup.GET("/runtime", func(c *gin.Context) {
		// Default to localhost because the backend is bound locally.
		host := "127.0.0.1"
		port := s.port
		if port == 0 {
			port = 8088
		}

		httpBase := fmt.Sprintf("http://%s:%d", host, port)
		wsBase := fmt.Sprintf("ws://%s:%d", host, port)
		c.JSON(http.StatusOK, models.RuntimeInfo{
			HTTPBaseURL: httpBase,
			WSBaseURL:   wsBase,
			Port:        port,
		})
	})

	// AI Agent Chat API route
	// /api/chat
	apiGroup.POST("/chat", agentService.HandleAgentChat)

	// Asset management API routes
	// /api/assets
	assetsGroup := apiGroup.Group("/assets")
	assetsGroup.POST("", assetHandler.Create)
	assetsGroup.GET("", assetHandler.List)
	assetsGroup.GET(":id", assetHandler.Get)
	assetsGroup.PUT(":id", assetHandler.Update)
	assetsGroup.PUT(":id/move", assetHandler.Move)
	assetsGroup.DELETE(":id", assetHandler.Delete)
	assetsGroup.POST("/import/ssh", assetHandler.ImportSSH)
	assetsGroup.GET("/ssh-config", assetHandler.ParseSSH)
	assetsGroup.GET("/user-ssh-keys", assetHandler.ListSSHKeys)          // added endpoint
	assetsGroup.GET("/user-ssh-key-inspect", assetHandler.InspectSSHKey) // inspect single key

	// Model management API routes
	// /api/models
	apiGroup.GET("/models", modelService.GetModelList)
	apiGroup.POST("/models", modelService.AddModel)
	apiGroup.PUT("/models/:id", modelService.EditModel)
	apiGroup.DELETE("/models/:id", modelService.DeleteModel)
	apiGroup.POST("/models/test", modelService.TestModelConnection)

	// Register Ark provider related routes
	models.RegisterArkProviderRoutes(s.ginEngine)

	// Conversation management API routes
	// /api/conversations
	conversationsGroup := apiGroup.Group("/conversations")
	{
		conversationsGroup.GET("", s.getConversations(chatStoreService))
		conversationsGroup.POST("", s.createConversation(chatStoreService))
		conversationsGroup.GET(":id", s.getConversation(chatStoreService))
		conversationsGroup.PUT(":id/title", s.updateConversationTitle(chatStoreService))
		conversationsGroup.GET(":id/generateTitle", agentService.GenerateTitle)
		conversationsGroup.DELETE(":id", s.deleteConversation(chatStoreService))
		conversationsGroup.GET(":id/messages", s.getConversationMessages(chatStoreService))
	}

	// Quick command management API routes
	// /api/quickcmd
	quickCmdGroup := apiGroup.Group("/quickcmd")
	{
		quickCmdGroup.GET("", quickCmdHandler.List)
		quickCmdGroup.GET(":id", quickCmdHandler.Get)
		quickCmdGroup.POST("", quickCmdHandler.Create)
		quickCmdGroup.PUT(":id", quickCmdHandler.Update)
		quickCmdGroup.DELETE(":id", quickCmdHandler.Delete)
		quickCmdGroup.PUT("reorder", quickCmdHandler.Reorder)
	}
}

// Dialogue management handlers

// getConversations retrieves the list of conversations (supports filtering by asset ID)
func (s *Server) getConversations(chatService *service.ChatStoreService) gin.HandlerFunc {
	return func(c *gin.Context) {
		assetID := c.Query("asset_id")

		var conversations []service.Conversation
		var err error

		if assetID != "" {
			// Get the list of conversations by asset ID
			conversations, err = chatService.GetConversationsByAssetID(assetID)
		} else {
			// Get the list of all conversations
			conversations, err = chatService.GetConversations()
		}

		if err != nil {
			s.logger.Error("Failed to get conversations", "error", err)
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to get conversations"})
			return
		}

		c.JSON(http.StatusOK, conversations)
	}
}

// createConversation creates a new conversation
func (s *Server) createConversation(chatService *service.ChatStoreService) gin.HandlerFunc {
	return func(c *gin.Context) {
		var req struct {
			Title          string `json:"title" binding:"required"`
			AssetID        string `json:"asset_id" binding:"required"`
			AssetSessionID string `json:"asset_session_id" binding:"required"`
		}

		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request format"})
			return
		}

		conversation, err := chatService.CreateConversation(req.Title, req.AssetID, req.AssetSessionID)
		if err != nil {
			s.logger.Error("Failed to create conversation", "error", err)
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create conversation"})
			return
		}

		c.JSON(http.StatusOK, conversation)
	}
}

// getConversation retrieves a single conversation
func (s *Server) getConversation(chatService *service.ChatStoreService) gin.HandlerFunc {
	return func(c *gin.Context) {
		id := c.Param("id")
		if id == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Conversation ID is required"})
			return
		}

		conversation, err := chatService.GetConversation(id)
		if err != nil {
			s.logger.Error("Failed to get conversation", "error", err)
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to get conversation"})
			return
		}

		c.JSON(http.StatusOK, conversation)
	}
}

// updateConversationTitle updates the title of a conversation
func (s *Server) updateConversationTitle(chatService *service.ChatStoreService) gin.HandlerFunc {
	return func(c *gin.Context) {
		id := c.Param("id")
		if id == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Conversation ID is required"})
			return
		}

		var req struct {
			Title string `json:"title" binding:"required"`
		}

		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request format"})
			return
		}

		err := chatService.UpdateConversationTitle(id, req.Title)
		if err != nil {
			s.logger.Error("Failed to update conversation title", "error", err)
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update conversation title"})
			return
		}

		c.JSON(http.StatusOK, gin.H{"message": "Conversation title updated successfully"})
	}
}

// deleteConversation deletes a conversation
func (s *Server) deleteConversation(chatService *service.ChatStoreService) gin.HandlerFunc {
	return func(c *gin.Context) {
		id := c.Param("id")
		if id == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Conversation ID is required"})
			return
		}

		err := chatService.DeleteConversation(id)
		if err != nil {
			s.logger.Error("Failed to delete conversation", "error", err)
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to delete conversation"})
			return
		}

		c.JSON(http.StatusOK, gin.H{"message": "Conversation deleted successfully"})
	}
}

// getConversationMessages retrieves all messages of a conversation
func (s *Server) getConversationMessages(chatService *service.ChatStoreService) gin.HandlerFunc {
	return func(c *gin.Context) {
		id := c.Param("id")
		if id == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Conversation ID is required"})
			return
		}

		messages, err := chatService.GetConversationMessages(id)
		if err != nil {
			s.logger.Error("Failed to get conversation messages", "error", err)
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to get conversation messages"})
			return
		}

		c.JSON(http.StatusOK, messages)
	}
}
