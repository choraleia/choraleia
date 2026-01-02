package service

import (
	"context"
	"io"

	fsimpl "github.com/choraleia/choraleia/pkg/service/fs"
)

// FSService provides generic filesystem operations for different endpoint types.
// It is a thin wrapper around FSRegistry.
type FSService struct {
	reg *FSRegistry
}

func NewFSService(reg *FSRegistry) *FSService { return &FSService{reg: reg} }

// openFS creates a FileSystem instance from EndpointSpec.
// Type can be omitted if AssetID is provided - it will be auto-detected.
func (s *FSService) openFS(ctx context.Context, spec EndpointSpec) (fsimpl.FileSystem, error) {
	return s.reg.Open(ctx, spec)
}

// ListDir lists directory contents.
func (s *FSService) ListDir(ctx context.Context, spec EndpointSpec, path string, opts fsimpl.ListDirOptions) (*fsimpl.ListDirResponse, error) {
	fs, err := s.openFS(ctx, spec)
	if err != nil {
		return nil, err
	}
	return fs.ListDir(ctx, path, opts)
}

// Stat returns file/directory info.
func (s *FSService) Stat(ctx context.Context, spec EndpointSpec, path string) (*fsimpl.FileEntry, error) {
	fs, err := s.openFS(ctx, spec)
	if err != nil {
		return nil, err
	}
	return fs.Stat(ctx, path)
}

// Mkdir creates a directory (and parents if needed).
func (s *FSService) Mkdir(ctx context.Context, spec EndpointSpec, path string) error {
	fs, err := s.openFS(ctx, spec)
	if err != nil {
		return err
	}
	return fs.MkdirAll(ctx, path)
}

// Remove deletes a file or directory.
func (s *FSService) Remove(ctx context.Context, spec EndpointSpec, path string) error {
	fs, err := s.openFS(ctx, spec)
	if err != nil {
		return err
	}
	return fs.Remove(ctx, path)
}

// Rename moves/renames a file or directory.
func (s *FSService) Rename(ctx context.Context, spec EndpointSpec, from, to string) error {
	fs, err := s.openFS(ctx, spec)
	if err != nil {
		return err
	}
	return fs.Rename(ctx, from, to)
}

// Download streams a file to w and returns a suggested filename.
func (s *FSService) Download(ctx context.Context, spec EndpointSpec, path string, w io.Writer) (string, error) {
	fs, err := s.openFS(ctx, spec)
	if err != nil {
		return "", err
	}
	r, err := fs.OpenRead(ctx, path)
	if err != nil {
		return "", err
	}
	defer func() { _ = r.Close() }()

	if _, err := io.Copy(w, r); err != nil {
		return "", err
	}

	name := basenamePosix(path)
	if name == "" {
		name = "download"
	}
	return name, nil
}

// Upload writes data to a file.
func (s *FSService) Upload(ctx context.Context, spec EndpointSpec, path string, r io.Reader, overwrite bool) error {
	fs, err := s.openFS(ctx, spec)
	if err != nil {
		return err
	}
	w, err := fs.OpenWrite(ctx, path, fsimpl.OpenWriteOptions{Overwrite: overwrite})
	if err != nil {
		return err
	}
	defer func() { _ = w.Close() }()
	_, err = io.Copy(w, r)
	return err
}

// Pwd returns a best-effort current/default directory for the given endpoint.
func (s *FSService) Pwd(ctx context.Context, spec EndpointSpec) (string, error) {
	fs, err := s.openFS(ctx, spec)
	if err != nil {
		return "", err
	}
	pfs, ok := fs.(fsimpl.PwdProvider)
	if !ok {
		return "/", nil
	}
	return pfs.Pwd(ctx)
}

func basenamePosix(p string) string {
	if p == "" || p == "/" {
		return ""
	}
	for len(p) > 1 && p[len(p)-1] == '/' {
		p = p[:len(p)-1]
	}
	idx := -1
	for i := len(p) - 1; i >= 0; i-- {
		if p[i] == '/' {
			idx = i
			break
		}
	}
	if idx >= 0 {
		return p[idx+1:]
	}
	return p
}
