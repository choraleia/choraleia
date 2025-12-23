package fs

import (
	"context"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

// LocalFileSystem implements FileSystem for the host filesystem.
//
// NOTE: This is NOT sandboxed.
type LocalFileSystem struct{}

func NewLocalFileSystem() *LocalFileSystem { return &LocalFileSystem{} }

func (l *LocalFileSystem) ListDir(ctx context.Context, p string, opts ListDirOptions) (*ListDirResponse, error) {
	_ = ctx
	abs, err := normalizeHostAbs(p)
	if err != nil {
		return nil, err
	}

	fi, err := os.Stat(abs)
	if err != nil {
		return nil, err
	}
	if !fi.IsDir() {
		return nil, fmt.Errorf("path is not a directory")
	}

	des, err := os.ReadDir(abs)
	if err != nil {
		return nil, err
	}

	entries := make([]FileEntry, 0, len(des))
	for _, de := range des {
		name := de.Name()
		if name == "." || name == ".." {
			continue
		}
		if !opts.IncludeHidden && strings.HasPrefix(name, ".") {
			continue
		}
		info, err := de.Info()
		if err != nil {
			continue
		}
		child := filepath.ToSlash(filepath.Join(abs, name))
		entries = append(entries, FileEntry{
			Name:    name,
			Path:    child,
			IsDir:   info.IsDir(),
			Size:    info.Size(),
			Mode:    info.Mode().String(),
			ModTime: info.ModTime(),
		})
	}

	sort.Slice(entries, func(i, j int) bool {
		if entries[i].IsDir != entries[j].IsDir {
			return entries[i].IsDir
		}
		return strings.ToLower(entries[i].Name) < strings.ToLower(entries[j].Name)
	})

	return &ListDirResponse{Path: filepath.ToSlash(abs), Entries: entries}, nil
}

func (l *LocalFileSystem) Stat(ctx context.Context, p string) (*FileEntry, error) {
	_ = ctx
	abs, err := normalizeHostAbs(p)
	if err != nil {
		return nil, err
	}
	fi, err := os.Stat(abs)
	if err != nil {
		return nil, err
	}
	name := filepath.Base(abs)
	if abs == "/" {
		name = "/"
	}
	return &FileEntry{Name: name, Path: filepath.ToSlash(abs), IsDir: fi.IsDir(), Size: fi.Size(), Mode: fi.Mode().String(), ModTime: fi.ModTime()}, nil
}

func (l *LocalFileSystem) MkdirAll(ctx context.Context, p string) error {
	_ = ctx
	abs, err := normalizeHostAbs(p)
	if err != nil {
		return err
	}
	return os.MkdirAll(abs, 0o700)
}

func (l *LocalFileSystem) Remove(ctx context.Context, p string) error {
	_ = ctx
	abs, err := normalizeHostAbs(p)
	if err != nil {
		return err
	}
	return os.Remove(abs)
}

func (l *LocalFileSystem) Rename(ctx context.Context, from string, to string) error {
	_ = ctx
	fromAbs, err := normalizeHostAbs(from)
	if err != nil {
		return err
	}
	toAbs, err := normalizeHostAbs(to)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(toAbs), 0o700); err != nil {
		return err
	}
	return os.Rename(fromAbs, toAbs)
}

func (l *LocalFileSystem) OpenRead(ctx context.Context, p string) (io.ReadCloser, error) {
	_ = ctx
	abs, err := normalizeHostAbs(p)
	if err != nil {
		return nil, err
	}
	return os.Open(abs)
}

func (l *LocalFileSystem) OpenWrite(ctx context.Context, p string, opts OpenWriteOptions) (io.WriteCloser, error) {
	_ = ctx
	abs, err := normalizeHostAbs(p)
	if err != nil {
		return nil, err
	}
	flag := os.O_WRONLY | os.O_CREATE
	if opts.Overwrite {
		flag |= os.O_TRUNC
	} else {
		flag |= os.O_EXCL
	}
	if err := os.MkdirAll(filepath.Dir(abs), 0o700); err != nil {
		return nil, err
	}
	return os.OpenFile(abs, flag, 0o600)
}

func (l *LocalFileSystem) Pwd(ctx context.Context) (string, error) {
	_ = ctx
	h, err := os.UserHomeDir()
	if err != nil || strings.TrimSpace(h) == "" {
		return "/", nil
	}
	return filepath.ToSlash(h), nil
}

func normalizeHostAbs(p string) (string, error) {
	p = strings.TrimSpace(p)
	if p == "" {
		p = "/"
	}
	abs := filepath.Clean(p)
	if abs == "." {
		abs = "/"
	}
	if !filepath.IsAbs(abs) {
		return "", fmt.Errorf("path must be absolute")
	}
	// Ensure POSIX slashes in the API.
	return filepath.ToSlash(abs), nil
}
