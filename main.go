//go:build !headless

package main

import (
	"embed"
	"fmt"
	"github.com/choraleia/choraleia/pkg/utils"
	"github.com/wailsapp/wails/v3/pkg/application"
	"log/slog"
	"os"
)

// Wails uses Go's `embed` package to embed the frontend files into the binary.
// Any files in the frontend/dist folder will be embedded into the binary and
// made available to the frontend.
// See https://pkg.go.dev/embed for more information.

//go:embed all:frontend/dist
var assets embed.FS

// main function serves as the application's entry point. It initializes the application, creates a window,
// and starts a goroutine that emits a time-based event every second. It subsequently runs the application and
// logs any error that might occur.
func main() {
	// Initialize logging system
	utils.InitLogger()
	logger := utils.GetLogger()

	// Create a new Wails application by providing the necessary options.
	// Variables 'Name' and 'Description' are for application metadata.
	// 'Assets' configures the asset server with the 'FS' variable pointing to the frontend files.
	// 'Bind' is a list of Go struct instances. The frontend has access to the methods of these instances.
	// 'Mac' options tailor the application when running an macOS.
	app := application.New(application.Options{
		Name:        "choraleia",
		Description: "Choraleia - The terminal application with AI support",
		LogLevel:    slog.LevelDebug,
		Services:    []application.Service{},
		Assets: application.AssetOptions{
			Handler: application.AssetFileServerFS(assets),
		},
		Mac: application.MacOptions{
			ApplicationShouldTerminateAfterLastWindowClosed: true,
		},
	})

	// Create a new window with the necessary options.
	app.Window.NewWithOptions(application.WebviewWindowOptions{
		Title: "Choraleia - Multi-Functional AI Terminal Tool",
		Mac: application.MacWindow{
			InvisibleTitleBarHeight: 50,
			Backdrop:                application.MacBackdropTranslucent,
			TitleBar:                application.MacTitleBarHiddenInset,
		},
		URL: "/",
	})

	// Start the http server
	server := NewServer()
	err := server.Start(app.Context())
	if err != nil {
		fmt.Println("Server start failed", err)
		logger.Error("Failed to start server", "error", err)
		os.Exit(1)
	}

	// Run the application. This blocks until the application has been exited.
	err = app.Run()
	if err != nil {
		logger.Error("Failed to run application", "error", err)
		os.Exit(1)
	}

	// If an error occurred while running the application, log it and exit.
	if err != nil {
		logger.Error("Application run failed", "error", err)
		os.Exit(1)
	}
}
