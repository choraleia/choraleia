package fs

import (
	"archive/tar"
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

// TarDirectory creates a tar stream of a directory (recursive).
func (l *LocalFileSystem) TarDirectory(ctx context.Context, dirPath string) (io.ReadCloser, error) {
	abs, err := normalizeHostAbs(dirPath)
	if err != nil {
		return nil, err
	}

	pr, pw := io.Pipe()

	go func() {
		tw := tar.NewWriter(pw)
		err := filepath.Walk(abs, func(file string, fi os.FileInfo, err error) error {
			if err != nil {
				return err
			}

			// Check context cancellation
			select {
			case <-ctx.Done():
				return ctx.Err()
			default:
			}

			// Get relative path
			rel, err := filepath.Rel(abs, file)
			if err != nil {
				return err
			}
			if rel == "." {
				return nil // Skip root directory itself
			}
			rel = filepath.ToSlash(rel)

			// Create tar header
			header, err := tar.FileInfoHeader(fi, "")
			if err != nil {
				return err
			}
			header.Name = rel

			// Handle symlinks
			if fi.Mode()&os.ModeSymlink != 0 {
				link, err := os.Readlink(file)
				if err != nil {
					return err
				}
				header.Linkname = link
			}

			if err := tw.WriteHeader(header); err != nil {
				return err
			}

			// Write file content if it's a regular file
			if fi.Mode().IsRegular() {
				f, err := os.Open(file)
				if err != nil {
					return err
				}
				_, err = io.Copy(tw, f)
				f.Close()
				if err != nil {
					return err
				}
			}

			return nil
		})

		tw.Close()
		if err != nil {
			pw.CloseWithError(err)
		} else {
			pw.Close()
		}
	}()

	return pr, nil
}

// UntarToDirectory extracts a tar stream to a directory.
func (l *LocalFileSystem) UntarToDirectory(ctx context.Context, dirPath string) (io.WriteCloser, error) {
	abs, err := normalizeHostAbs(dirPath)
	if err != nil {
		return nil, err
	}

	// Ensure directory exists
	if err := os.MkdirAll(abs, 0o755); err != nil {
		return nil, err
	}

	pr, pw := io.Pipe()
	errCh := make(chan error, 1)

	go func() {
		tr := tar.NewReader(pr)
		var extractErr error

		for {
			header, err := tr.Next()
			if err == io.EOF {
				break
			}
			if err != nil {
				// Could be due to pipe being closed, or actual tar error
				extractErr = fmt.Errorf("tar read error: %w", err)
				break
			}

			// Check context cancellation
			select {
			case <-ctx.Done():
				extractErr = ctx.Err()
			default:
			}
			if extractErr != nil {
				break
			}

			// Skip empty names
			if header.Name == "" || header.Name == "." {
				continue
			}

			// Construct target path
			target := filepath.Join(abs, filepath.FromSlash(header.Name))

			// Security check: ensure target is within abs
			cleanTarget := filepath.Clean(target)
			cleanAbs := filepath.Clean(abs)
			if cleanTarget != cleanAbs && !strings.HasPrefix(cleanTarget, cleanAbs+string(filepath.Separator)) {
				continue // Skip files that would escape the target directory
			}

			switch header.Typeflag {
			case tar.TypeDir:
				if err := os.MkdirAll(target, 0o755); err != nil {
					extractErr = fmt.Errorf("mkdir %s: %w", header.Name, err)
				}
			case tar.TypeReg, tar.TypeRegA:
				if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
					extractErr = fmt.Errorf("mkdir parent for %s: %w", header.Name, err)
					break
				}
				f, err := os.OpenFile(target, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o644)
				if err != nil {
					extractErr = fmt.Errorf("create file %s: %w", header.Name, err)
					break
				}
				if _, err := io.Copy(f, tr); err != nil {
					f.Close()
					extractErr = fmt.Errorf("write file %s: %w", header.Name, err)
					break
				}
				f.Close()
			case tar.TypeSymlink:
				if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
					continue
				}
				os.Remove(target)
				_ = os.Symlink(header.Linkname, target)
			case tar.TypeLink:
				if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
					continue
				}
				os.Remove(target)
				linkTarget := filepath.Join(abs, filepath.FromSlash(header.Linkname))
				_ = os.Link(linkTarget, target)
			default:
				// Skip other types (char devices, block devices, fifos, etc.)
				continue
			}

			if extractErr != nil {
				break
			}
		}

		// Send error (or nil) to channel
		errCh <- extractErr

		// Drain any remaining data to prevent blocking the writer
		// This is important when we exit early due to error
		io.Copy(io.Discard, pr)
		pr.Close()
	}()

	// Return a wrapper that captures the extraction error on close
	return &untarWriter{pw: pw, errCh: errCh}, nil
}

// untarWriter wraps pipe writer and captures extraction error
type untarWriter struct {
	pw    *io.PipeWriter
	errCh chan error
}

func (w *untarWriter) Write(p []byte) (int, error) {
	return w.pw.Write(p)
}

func (w *untarWriter) Close() error {
	// Close the pipe writer to signal EOF to reader
	w.pw.Close()

	// Wait for extraction to complete and get any error
	if err := <-w.errCh; err != nil {
		return err
	}
	return nil
}

// Verify interface implementations
var _ FileSystem = (*LocalFileSystem)(nil)
var _ PwdProvider = (*LocalFileSystem)(nil)
var _ TarStreamer = (*LocalFileSystem)(nil)

func normalizeHostAbs(p string) (string, error) {
	p = strings.TrimSpace(p)
	if p == "" {
		p = "."
	}
	abs, err := filepath.Abs(p)
	if err != nil {
		return "", err
	}
	return filepath.ToSlash(abs), nil
}
