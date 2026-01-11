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

	"github.com/choraleia/choraleia/pkg/config"
	"github.com/choraleia/choraleia/pkg/event"
	"github.com/choraleia/choraleia/pkg/handler"
	"github.com/choraleia/choraleia/pkg/service"
	"github.com/choraleia/choraleia/pkg/tools"
	"github.com/choraleia/choraleia/pkg/utils"
	"github.com/gin-gonic/gin"
	"github.com/gorilla/websocket"

	// Import to register built-in tools
	_ "github.com/choraleia/choraleia/pkg/tools/all"
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

	// CORS middleware: allow typical localhost dev origins.
	// The GUI webview loads the app from the same-origin HTTP server, so CORS is mostly for dev tooling.
	ginEngine.Use(func(c *gin.Context) {
		origin := c.Request.Header.Get("Origin")

		// If there's no Origin header, it's not a browser CORS request.
		if origin != "" {
			allowed := false

			if strings.HasPrefix(origin, "http://localhost") ||
				strings.HasPrefix(origin, "http://127.0.0.1") ||
				strings.HasPrefix(origin, "https://localhost") ||
				strings.HasPrefix(origin, "https://127.0.0.1") {
				allowed = true
			}

			if allowed {
				c.Header("Access-Control-Allow-Origin", origin)
				c.Header("Vary", "Origin")
				c.Header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
				c.Header("Access-Control-Allow-Headers", "Origin, Content-Type, Accept, Authorization")
			} else {
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

	// Enable embedded static middleware (both GUI and headless builds).
	// The actual port is discovered after Start() binds the listener.
	// The middleware reads the current port via this closure.
	attachStatic(ginEngine, func() int { return server.port })

	server.SetupRoutes()

	// Ensure SPA routes work even if middleware ordering changes or static assets are missing.
	ginEngine.NoRoute(func(c *gin.Context) {
		// Try to serve embedded/static index.html fallback for SPA routes.
		serveIndexFallback(c, func() int { return server.port })
		if c.IsAborted() {
			return
		}
		c.Status(http.StatusNotFound)
	})

	return server
}

func (s *Server) Start(ctx context.Context) error {
	// Load server port from YAML config file under the user's home directory.
	// If the config file doesn't exist, a default one will be created.
	if _, err := config.EnsureDefaultConfig(); err != nil {
		s.logger.Warn("Failed to ensure default config; falling back to defaults", "error", err)
	}

	cfg, cfgPath, err := config.Load()
	if err != nil {
		return fmt.Errorf("load config: %w", err)
	}
	port := cfg.Port()
	host := cfg.Host()
	s.logger.Info("Config loaded", "path", cfgPath, "host", host, "port", port)

	addr := net.JoinHostPort(host, strconv.Itoa(port))
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

	// Create Docker service instance
	dockerService := service.NewDockerService(assetService)
	dockerHandler := handler.NewDockerHandler(assetService, dockerService, s.logger)

	// Task system (background jobs)
	taskService := service.NewTaskService(2)
	transferTaskService := service.NewTransferTaskService(taskService, assetService)
	taskHandler := handler.NewTaskHandler(taskService, transferTaskService)

	// Remove legacy SFTP/localfs handlers; use /api/fs/* for filesystem operations.
	assetHandler := handler.NewAssetHandler(assetService, s.logger)

	// Create generic filesystem service/handler (local + sftp + docker now; k8s later)
	fsRegistry := service.NewFSRegistry(assetService)
	fsService := service.NewFSService(fsRegistry)
	fsHandler := handler.NewFSHandler(fsService)

	// Create quick command service instance
	quickCmdService := service.NewQuickCommandService()
	quickCmdHandler := handler.NewQuickCmdHandler(quickCmdService, s.logger)

	// Create tunnel service and handler
	tunnelService := service.NewTunnelService(assetService)
	tunnelHandler := handler.NewTunnelHandler(tunnelService, s.logger)

	// Terminal connection routes
	// /terminal
	termGroups := s.ginEngine.Group("/terminal")
	termGroups.GET("connect/:assetId", terminalService.RunTerminal)
	// Docker container terminal: /terminal/docker/:assetId/:containerId
	termGroups.GET("docker/:assetId/:containerId", terminalService.RunDockerTerminal)

	// API group
	// /api
	apiGroup := s.ginEngine.Group("/api")

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
	// Docker host container management
	assetsGroup.GET(":id/docker/containers", dockerHandler.ListContainers)
	assetsGroup.POST(":id/docker/containers/:containerId/:action", dockerHandler.ContainerAction)
	assetsGroup.POST(":id/docker/test", dockerHandler.TestConnection)

	// Docker test without asset (for form validation)
	apiGroup.POST("/docker/test", dockerHandler.TestConnectionByConfig)

	// Model management API routes
	// /api/models
	apiGroup.GET("/models", modelService.GetModelList)
	apiGroup.POST("/models", modelService.AddModel)
	apiGroup.PUT("/models/:id", modelService.EditModel)
	apiGroup.DELETE("/models/:id", modelService.DeleteModel)
	apiGroup.POST("/models/test", modelService.TestModelConnection)
	apiGroup.GET("/models/presets", handler.GetPresets)
	apiGroup.GET("/models/provider-keys", modelService.GetProviderApiKeys)

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

	// Task API routes
	// /api/tasks
	tasksGroup := apiGroup.Group("/tasks")
	{
		tasksGroup.GET("", taskHandler.List)                // Unified list (active + history)
		tasksGroup.GET("/active", taskHandler.ListActive)   // Deprecated: use GET /tasks
		tasksGroup.GET("/history", taskHandler.ListHistory) // Deprecated: use GET /tasks
		tasksGroup.POST("/transfer", taskHandler.EnqueueTransfer)
		tasksGroup.POST("/:id/cancel", taskHandler.Cancel)
		tasksGroup.GET("/ws", taskHandler.EventsWS)
	}

	// Generic filesystem API routes
	// /api/fs
	fsGroup := apiGroup.Group("/fs")
	{
		fsGroup.GET("/ls", fsHandler.List)
		fsGroup.GET("/stat", fsHandler.Stat)
		fsGroup.GET("/download", fsHandler.Download)
		fsGroup.GET("/read", fsHandler.Read)
		fsGroup.POST("/upload", fsHandler.Upload)
		fsGroup.POST("/write", fsHandler.Write)
		fsGroup.POST("/mkdir", fsHandler.Mkdir)
		fsGroup.POST("/touch", fsHandler.Touch)
		fsGroup.POST("/rm", fsHandler.Remove)
		fsGroup.POST("/rename", fsHandler.Rename)
		fsGroup.POST("/copy", fsHandler.Copy)
		fsGroup.GET("/pwd", fsHandler.Pwd)
	}

	// Quick command API routes
	// /api/quickcmd
	quickCmdGroup := apiGroup.Group("/quickcmd")
	{
		quickCmdGroup.GET("", quickCmdHandler.List)
		quickCmdGroup.POST("", quickCmdHandler.Create)
		quickCmdGroup.GET("/:id", quickCmdHandler.Get)
		quickCmdGroup.PUT("/:id", quickCmdHandler.Update)
		quickCmdGroup.DELETE("/:id", quickCmdHandler.Delete)
		quickCmdGroup.POST("/reorder", quickCmdHandler.Reorder)
	}

	// Tunnel API routes
	// /api/tunnels
	tunnelsGroup := apiGroup.Group("/tunnels")
	{
		tunnelsGroup.GET("", tunnelHandler.List)
		tunnelsGroup.GET("/stats", tunnelHandler.GetStats)
		tunnelsGroup.POST("/:id/start", tunnelHandler.Start)
		tunnelsGroup.POST("/:id/stop", tunnelHandler.Stop)
	}

	// Workspace API routes
	// /api/workspaces
	workspaceService := service.NewWorkspaceService(chatStoreService.DB())
	if err := workspaceService.AutoMigrate(); err != nil {
		s.logger.Error("Failed to migrate workspace tables", "error", err)
	}
	// Inject DockerService, SSHPool, and RuntimeStatusService into WorkspaceService's RuntimeManager
	workspaceService.SetDockerService(dockerService)
	workspaceService.SetSSHPool(fsRegistry.SSHPool())
	// Explicitly set AssetService on RuntimeManager for workspace command execution
	workspaceService.GetRuntimeManager().SetAssetService(assetService)
	// Create and inject RuntimeStatusService for runtime monitoring
	runtimeStatusService := service.NewRuntimeStatusService(dockerService, assetService)
	runtimeStatusService.StartMonitoring(30 * time.Second) // Monitor every 30 seconds
	workspaceService.SetRuntimeStatusService(runtimeStatusService)
	// Setup callbacks for runtime events (e.g., save container ID when created)
	workspaceService.SetupRuntimeCallbacks()
	workspaceHandler := handler.NewWorkspaceHandler(workspaceService)
	workspaceHandler.RegisterRoutes(apiGroup)

	// Built-in Tools API route
	// /api/builtin-tools
	apiGroup.GET("/builtin-tools", func(c *gin.Context) {
		category := c.Query("category")
		scope := c.Query("scope")
		safeOnly := c.Query("safe_only") == "true"

		var defs []tools.ToolDefinition

		if category != "" {
			defs = tools.ListToolsByCategory(tools.ToolCategory(category))
		} else if scope != "" {
			defs = tools.ListToolsByScope(tools.ToolScope(scope))
		} else if safeOnly {
			defs = tools.ListSafeTools()
		} else {
			defs = tools.ListToolDefinitions()
		}

		// Convert to response format
		result := make([]map[string]interface{}, len(defs))
		for i, def := range defs {
			result[i] = map[string]interface{}{
				"id":          string(def.ID),
				"name":        def.Name,
				"description": def.Description,
				"category":    string(def.Category),
				"scope":       string(def.Scope),
				"dangerous":   def.Dangerous,
			}
		}

		c.JSON(200, gin.H{
			"tools": result,
			"categories": []string{
				string(tools.CategoryWorkspace),
				string(tools.CategoryAsset),
				string(tools.CategoryDatabase),
				string(tools.CategoryTransfer),
				string(tools.CategoryBrowser),
			},
		})
	})

	// Chat API routes (OpenAI-compatible)
	// /api/v1/chat/completions, /api/v1/conversations
	chatService := service.NewChatService(chatStoreService.DB(), modelService, workspaceService)
	if err := chatService.AutoMigrate(); err != nil {
		slog.Error("Failed to migrate chat tables", "error", err)
	}

	// Initialize browser service for browser automation tools
	browserService := service.NewBrowserService()
	browserService.SetSSHPool(fsRegistry.SSHPool())
	browserService.SetAssetService(assetService)
	// Set database for browser instance persistence
	if err := browserService.SetDB(chatStoreService.DB()); err != nil {
		slog.Error("Failed to set browser service DB", "error", err)
	}

	// Set browser service on chat service for context injection
	chatService.SetBrowserService(browserService)
	// Set asset service on chat service for asset info in system prompt
	chatService.SetAssetService(assetService)

	// Initialize tool context and loader for workspace tools
	toolCtx := tools.NewToolContext(fsService, assetService)
	// Configure workspace services for command execution in workspace runtime
	toolCtx.WithWorkspaceServices(workspaceService.GetRuntimeManager(), workspaceService)
	// Configure browser service for browser automation
	toolCtx.WithBrowserService(browserService)
	// Configure model service for vision analysis in browser tools
	toolCtx.WithModelService(modelService)
	toolLoader := tools.NewToolLoaderAdapter(toolCtx)
	chatService.SetToolLoader(toolLoader)

	// Browser API routes for preview
	browserHandler := handler.NewBrowserHandler(browserService)
	browserHandler.RegisterRoutes(apiGroup)
	// Set up browser state change notifications
	browserService.SetOnStateChange(browserHandler.BrowserStateHandler())

	chatHandler := handler.NewChatHandler(chatService)
	v1Group := apiGroup.Group("/v1")
	chatHandler.RegisterRoutes(v1Group)

	// Event notification WebSocket
	// /api/events/ws
	eventsHandler := event.NewWSHandler()
	apiGroup.GET("/events/ws", eventsHandler.Handle)
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
