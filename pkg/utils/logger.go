package utils

import (
	"log/slog"
	"os"
	"path/filepath"
)

var logger *slog.Logger

// InitLogger initialize logging system
func InitLogger() {
	// Get log directory under user home
	homeDir, _ := os.UserHomeDir()
	logDir := filepath.Join(homeDir, ".choraleia", "logs")
	_ = os.MkdirAll(logDir, 0755)

	// Create log file
	logFile := filepath.Join(logDir, "choraleia.log")
	file, err := os.OpenFile(logFile, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0666)
	if err != nil {
		// Fallback to stdout when file cannot be created
		logger = slog.New(slog.NewTextHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelDebug}))
		return
	}

	// Create JSON format handler
	handler := slog.NewJSONHandler(file, &slog.HandlerOptions{Level: slog.LevelDebug, AddSource: true})
	logger = slog.New(handler)

	// Set as default
	slog.SetDefault(logger)
}

// GetLogger get logger instance
func GetLogger() *slog.Logger {
	if logger == nil {
		InitLogger()
	}
	return logger
}
