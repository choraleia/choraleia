package repomap

import (
	"context"
	"io"
	"os"
	"path/filepath"
	"strings"

	fsimpl "github.com/choraleia/choraleia/pkg/service/fs"
)

// FSAdapter adapts fsimpl.FileSystem to repomap.FileSystem interface
type FSAdapter struct {
	fs       fsimpl.FileSystem
	rootPath string
}

// Ensure FSAdapter implements FileSystem interface
var _ FileSystem = (*FSAdapter)(nil)

// NewFSAdapter creates a new FSAdapter with automatic tilde expansion
// Use this for simple cases where tilde should be expanded on local machine
func NewFSAdapter(fs fsimpl.FileSystem, rootPath string) *FSAdapter {
	// Expand ~ to home directory
	expandedPath := expandTilde(rootPath)
	return &FSAdapter{
		fs:       fs,
		rootPath: expandedPath,
	}
}

// NewFSAdapterWithExpandedPath creates a new FSAdapter with an already-expanded path
// Use this when the caller has already handled path expansion (e.g., for different runtime environments)
func NewFSAdapterWithExpandedPath(fs fsimpl.FileSystem, rootPath string) *FSAdapter {
	return &FSAdapter{
		fs:       fs,
		rootPath: rootPath,
	}
}

// expandTilde expands ~ to the user's home directory
func expandTilde(path string) string {
	if strings.HasPrefix(path, "~/") {
		home, err := os.UserHomeDir()
		if err == nil {
			return filepath.Join(home, path[2:])
		}
	} else if path == "~" {
		home, err := os.UserHomeDir()
		if err == nil {
			return home
		}
	}
	return path
}

// GetRootPath returns the root path
func (a *FSAdapter) GetRootPath() string {
	return a.rootPath
}

// toAbsPath converts a relative path to absolute path
func (a *FSAdapter) toAbsPath(relPath string) string {
	if relPath == "." || relPath == "" {
		return a.rootPath
	}
	// Handle absolute paths (for index file operations)
	if filepath.IsAbs(relPath) {
		return relPath
	}
	return filepath.Join(a.rootPath, relPath)
}

// ReadFile reads file content
func (a *FSAdapter) ReadFile(ctx context.Context, path string) (string, error) {
	absPath := a.toAbsPath(path)
	reader, err := a.fs.OpenRead(ctx, absPath)
	if err != nil {
		return "", err
	}
	defer reader.Close()

	content, err := io.ReadAll(reader)
	if err != nil {
		return "", err
	}
	return string(content), nil
}

// WriteFile writes content to a file
func (a *FSAdapter) WriteFile(ctx context.Context, path string, content []byte) error {
	absPath := a.toAbsPath(path)
	writer, err := a.fs.OpenWrite(ctx, absPath, fsimpl.OpenWriteOptions{Overwrite: true})
	if err != nil {
		return err
	}
	defer writer.Close()

	_, err = writer.Write(content)
	return err
}

// MkdirAll creates a directory and all parent directories
func (a *FSAdapter) MkdirAll(ctx context.Context, path string) error {
	absPath := a.toAbsPath(path)
	return a.fs.MkdirAll(ctx, absPath)
}

// FileExists checks if a file exists
func (a *FSAdapter) FileExists(ctx context.Context, path string) bool {
	absPath := a.toAbsPath(path)
	_, err := a.fs.Stat(ctx, absPath)
	return err == nil
}

// ListFiles lists files recursively
func (a *FSAdapter) ListFiles(ctx context.Context, path string, recursive bool) ([]FileInfo, error) {
	var files []FileInfo

	absPath := a.toAbsPath(path)
	err := a.listFilesRecursive(ctx, absPath, "", recursive, &files, 0, 20) // max depth 20
	if err != nil {
		return nil, err
	}

	return files, nil
}

func (a *FSAdapter) listFilesRecursive(ctx context.Context, absPath, relPath string, recursive bool, files *[]FileInfo, depth, maxDepth int) error {
	if depth > maxDepth {
		return nil
	}

	resp, err := a.fs.ListDir(ctx, absPath, fsimpl.ListDirOptions{
		IncludeHidden: false,
	})
	if err != nil {
		return err
	}

	for _, entry := range resp.Entries {
		// Skip hidden files/dirs and common ignored paths
		if strings.HasPrefix(entry.Name, ".") {
			continue
		}
		if shouldSkipDir(entry.Name) {
			continue
		}

		// Build relative path (what we return)
		entryRelPath := entry.Name
		if relPath != "" {
			entryRelPath = relPath + "/" + entry.Name
		}

		// Build absolute path (for filesystem operations)
		entryAbsPath := filepath.Join(absPath, entry.Name)

		*files = append(*files, FileInfo{
			Path:  entryRelPath,
			IsDir: entry.IsDir,
			Size:  entry.Size,
		})

		if entry.IsDir && recursive {
			if err := a.listFilesRecursive(ctx, entryAbsPath, entryRelPath, recursive, files, depth+1, maxDepth); err != nil {
				// Log but continue on errors
				continue
			}
		}
	}

	return nil
}

// shouldSkipDir checks if a directory should be skipped
func shouldSkipDir(name string) bool {
	// Skip all hidden directories (starting with .)
	if strings.HasPrefix(name, ".") {
		return true
	}
	// Skip common large/generated directories
	skipDirs := map[string]bool{
		// JavaScript/Node.js
		"node_modules":     true,
		"bower_components": true,
		// Python
		"__pycache__":   true,
		"venv":          true,
		"env":           true,
		".eggs":         true,
		"site-packages": true,
		// Go
		"vendor": true,
		// Rust
		"target": true,
		// Java/Kotlin/Scala
		"out": true,
		// Build outputs
		"dist":   true,
		"build":  true,
		"_build": true,
		"output": true,
		"bin":    true,
		"obj":    true,
		// Package managers
		"packages": true,
		"pkg":      true,
		// Coverage/Test
		"coverage": true,
		"htmlcov":  true,
		// Logs
		"logs": true,
		"log":  true,
		// Temp
		"tmp":  true,
		"temp": true,
		// Cache
		"cache":         true,
		"__snapshots__": true,
	}
	return skipDirs[name]
}
