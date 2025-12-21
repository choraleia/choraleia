//go:build headless

package main

import (
	"context"
	"fmt"
	"os"
	"os/signal"
	"syscall"

	"github.com/choraleia/choraleia/pkg/utils"
)

// Backend-only mode entry: do not initialize Wails, only start API service (static assets served via Gin middleware AttachStatic)
func main() {
	utils.InitLogger()
	logger := utils.GetLogger()

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	apiServer := NewServer()
	if err := apiServer.Start(ctx); err != nil {
		fmt.Println("Failed to start service", err)
		logger.Error("Failed to start API service", "error", err)
		os.Exit(1)
	}

	// Block until exit signal received
	<-ctx.Done()
	logger.Info("Exit signal received, shutting down (headless mode)")
}
