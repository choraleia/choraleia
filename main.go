//go:build !headless

package main

import (
	"fmt"
	"log/slog"
	"os"
	"strings"

	"github.com/choraleia/choraleia/pkg/config"
	"github.com/choraleia/choraleia/pkg/utils"
	"github.com/wailsapp/wails/v3/pkg/application"
)

// resolveFrontendURL decides what URL the webview should load.
//
// In Wails dev mode, a Vite dev server is started (see build/config.yml + build/Taskfile.yml).
// For hot reload to work, the webview must load the Vite server URL, not the Go backend URL.
func resolveFrontendURL(serverURL string) string {
	// 1) If a full dev server URL is explicitly provided, prefer it.
	// These names are defensive; different launchers may set different env vars.
	for _, k := range []string{"CHORALEIA_DEV_SERVER_URL", "WAILS_DEV_SERVER_URL", "WAILS_FRONTEND_URL"} {
		if v := strings.TrimSpace(os.Getenv(k)); v != "" {
			return v
		}
	}

	// 2) If Wails provides the Vite port, use it.
	// Taskfile.yml defines default WAILS_VITE_PORT=9245.
	if p := strings.TrimSpace(os.Getenv("WAILS_VITE_PORT")); p != "" {
		return fmt.Sprintf("http://localhost:%s", p)
	}

	// 3) Fallback to the built-in Go server URL (production / non-dev).
	return serverURL
}

// main function serves as the application's entry point. It initializes the application, creates a window,
// and starts a goroutine that emits a time-based event every second. It subsequently runs the application and
// logs any error that might occur.
func main() {
	// Initialize logging system
	utils.InitLogger()
	logger := utils.GetLogger()

	server := NewServer()

	// Create a new Wails application first to get a context, but start the server
	// before opening the window to avoid initial load failures.
	app := application.New(application.Options{
		Name:        "choraleia",
		Description: "Choraleia - The terminal application with AI support",
		LogLevel:    slog.LevelDebug,
		Services:    []application.Service{},
		Mac: application.MacOptions{
			ApplicationShouldTerminateAfterLastWindowClosed: true,
		},
	})

	// Start the http server (API + WebSocket) before opening the window.
	err := server.Start(app.Context())
	if err != nil {
		fmt.Println("Server start failed", err)
		logger.Error("Failed to start server", "error", err)
		os.Exit(1)
	}

	// Read config after starting (it should match what the server bound to).
	cfg, _, cfgErr := config.Load()
	if cfgErr != nil {
		logger.Warn("Failed to load config; falling back to defaults", "error", cfgErr)
		cfg = &config.AppConfig{}
	}
	serverURL := fmt.Sprintf("http://%s:%d", cfg.Host(), cfg.Port())
	frontendURL := resolveFrontendURL(serverURL)

	// Create a new window with the necessary options.
	app.Window.NewWithOptions(application.WebviewWindowOptions{
		Title: "Choraleia - Multi-Functional AI Terminal Tool",
		Mac: application.MacWindow{
			InvisibleTitleBarHeight: 50,
			Backdrop:                application.MacBackdropTranslucent,
			TitleBar:                application.MacTitleBarHiddenInset,
		},
		URL: frontendURL,
	})

	// Run the application. This blocks until the application has been exited.
	err = app.Run()
	if err != nil {
		logger.Error("Failed to run application", "error", err)
		os.Exit(1)
	}
}
