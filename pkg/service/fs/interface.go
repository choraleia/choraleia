package fs

import (
	"context"
	"io"
	"time"
)

// FileEntry describes one file or directory.
//
// Path semantics:
//   - Paths use forward slashes (POSIX-style).
//   - All paths are absolute (start with '/').
//   - No backend performs root-mapping/sandboxing at this layer.
type FileEntry struct {
	Name    string    `json:"name"`
	Path    string    `json:"path"`
	IsDir   bool      `json:"is_dir"`
	Size    int64     `json:"size"`
	Mode    string    `json:"mode"`
	ModTime time.Time `json:"mod_time"`
}

type ListDirResponse struct {
	Path    string      `json:"path"`
	Entries []FileEntry `json:"entries"`
}

type ListDirOptions struct {
	IncludeHidden bool
}

type OpenWriteOptions struct {
	Overwrite bool
}

// FileSystem abstracts file operations for local and remote backends.
//
// All methods must accept absolute POSIX paths.
type FileSystem interface {
	ListDir(ctx context.Context, path string, opts ListDirOptions) (*ListDirResponse, error)
	Stat(ctx context.Context, path string) (*FileEntry, error)
	MkdirAll(ctx context.Context, path string) error
	Remove(ctx context.Context, path string) error
	Rename(ctx context.Context, from string, to string) error

	OpenRead(ctx context.Context, path string) (io.ReadCloser, error)
	OpenWrite(ctx context.Context, path string, opts OpenWriteOptions) (io.WriteCloser, error)
}

// Optional interface: implementations that can report a preferred starting directory.
// Returned path must be absolute.
type PwdProvider interface {
	Pwd(ctx context.Context) (string, error)
}
