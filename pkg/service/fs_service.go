package service

import (
	"context"
	"fmt"
	"io"
	"strings"

	fsimpl "github.com/choraleia/choraleia/pkg/service/fs"
)

// FSService provides generic filesystem operations for different endpoint types.
// It is a thin wrapper around FSRegistry.
type FSService struct {
	reg *FSRegistry
}

func NewFSService(reg *FSRegistry) *FSService { return &FSService{reg: reg} }

func (s *FSService) openFS(ctx context.Context, typ EndpointType, assetID string) (fsimpl.FileSystem, error) {
	return s.reg.Open(ctx, EndpointSpec{Type: typ, AssetID: assetID})
}

func (s *FSService) ListDir(ctx context.Context, typ EndpointType, assetID string, path string, opts fsimpl.ListDirOptions) (*fsimpl.ListDirResponse, error) {
	fs, err := s.openFS(ctx, typ, assetID)
	if err != nil {
		return nil, err
	}
	return fs.ListDir(ctx, path, opts)
}

func (s *FSService) Stat(ctx context.Context, typ EndpointType, assetID string, path string) (*fsimpl.FileEntry, error) {
	fs, err := s.openFS(ctx, typ, assetID)
	if err != nil {
		return nil, err
	}
	return fs.Stat(ctx, path)
}

func (s *FSService) Mkdir(ctx context.Context, typ EndpointType, assetID string, path string) error {
	fs, err := s.openFS(ctx, typ, assetID)
	if err != nil {
		return err
	}
	return fs.MkdirAll(ctx, path)
}

func (s *FSService) Remove(ctx context.Context, typ EndpointType, assetID string, path string) error {
	fs, err := s.openFS(ctx, typ, assetID)
	if err != nil {
		return err
	}
	return fs.Remove(ctx, path)
}

func (s *FSService) Rename(ctx context.Context, typ EndpointType, assetID string, from string, to string) error {
	fs, err := s.openFS(ctx, typ, assetID)
	if err != nil {
		return err
	}
	return fs.Rename(ctx, from, to)
}

// Download streams a file to w and returns a suggested filename.
func (s *FSService) Download(ctx context.Context, typ EndpointType, assetID string, path string, w io.Writer) (string, error) {
	fs, err := s.openFS(ctx, typ, assetID)
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

func (s *FSService) Upload(ctx context.Context, typ EndpointType, assetID string, path string, r io.Reader, overwrite bool) error {
	fs, err := s.openFS(ctx, typ, assetID)
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
//
// Contract:
//   - Returned path is POSIX absolute.
//   - No root mapping is applied.
//
// Behavior:
//   - local: returns current user's home directory if available, otherwise '/'.
//   - sftp: tries SFTP Getwd(), falls back to '/'.
//   - docker: returns '/'.
func (s *FSService) Pwd(ctx context.Context, typ EndpointType, assetID string) (string, error) {
	fs, err := s.openFS(ctx, typ, assetID)
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
	// Minimal POSIX basename without depending on filepath semantics.
	// p is expected to use forward slashes.
	if p == "" || p == "/" {
		return ""
	}
	// trim trailing /
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

func validateEndpointType(t string) (EndpointType, error) {
	switch EndpointType(t) {
	case EndpointLocal, EndpointSFTP, EndpointDocker, EndpointK8sPod:
		return EndpointType(t), nil
	default:
		return "", fmt.Errorf("unsupported endpoint type: %s", t)
	}
}

// ValidateEndpointTypeForHTTP parses and validates an endpoint type string.
// Kept exported for handlers.
func ValidateEndpointTypeForHTTP(raw string) (EndpointType, error) {
	t := EndpointType(strings.TrimSpace(raw))
	switch t {
	case EndpointLocal, EndpointSFTP, EndpointDocker, EndpointK8sPod:
		return t, nil
	default:
		return "", fmt.Errorf("invalid endpoint type: %s", raw)
	}
}
