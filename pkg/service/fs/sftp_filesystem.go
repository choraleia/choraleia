package fs

import (
	"context"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"github.com/pkg/sftp"
)

// SFTPFileSystem implements FileSystem using an existing *sftp.Client.
//
// The client provisioning (SSH auth, pooling, etc.) should live outside this package.
type SFTPFileSystem struct {
	client *sftp.Client
}

func NewSFTPFileSystem(client *sftp.Client) (*SFTPFileSystem, error) {
	if client == nil {
		return nil, fmt.Errorf("sftp client is nil")
	}
	return &SFTPFileSystem{client: client}, nil
}

func (s *SFTPFileSystem) ListDir(ctx context.Context, p string, opts ListDirOptions) (*ListDirResponse, error) {
	pathToList, err := normalizeRemotePath(p)
	if err != nil {
		return nil, err
	}
	infos, err := s.client.ReadDir(pathToList)
	if err != nil {
		return nil, err
	}

	entries := make([]FileEntry, 0, len(infos))
	for _, fi := range infos {
		name := fi.Name()
		if name == "." || name == ".." {
			continue
		}
		if !opts.IncludeHidden && strings.HasPrefix(name, ".") {
			continue
		}
		entries = append(entries, FileEntry{
			Name:    name,
			Path:    joinRemote(pathToList, name),
			IsDir:   fi.IsDir(),
			Size:    fi.Size(),
			Mode:    fi.Mode().String(),
			ModTime: fi.ModTime(),
		})
	}

	sort.Slice(entries, func(i, j int) bool {
		if entries[i].IsDir != entries[j].IsDir {
			return entries[i].IsDir
		}
		return strings.ToLower(entries[i].Name) < strings.ToLower(entries[j].Name)
	})

	return &ListDirResponse{Path: pathToList, Entries: entries}, nil
}

func (s *SFTPFileSystem) Stat(ctx context.Context, p string) (*FileEntry, error) {
	_ = ctx
	remotePath, err := normalizeRemotePath(p)
	if err != nil {
		return nil, err
	}
	fi, err := s.client.Stat(remotePath)
	if err != nil {
		return nil, err
	}
	return &FileEntry{
		Name:    filepath.Base(remotePath),
		Path:    remotePath,
		IsDir:   fi.IsDir(),
		Size:    fi.Size(),
		Mode:    fi.Mode().String(),
		ModTime: fi.ModTime(),
	}, nil
}

func (s *SFTPFileSystem) MkdirAll(ctx context.Context, p string) error {
	_ = ctx
	remotePath, err := normalizeRemotePath(p)
	if err != nil {
		return err
	}
	return s.client.MkdirAll(remotePath)
}

func (s *SFTPFileSystem) Remove(ctx context.Context, p string) error {
	_ = ctx
	remotePath, err := normalizeRemotePath(p)
	if err != nil {
		return err
	}
	fi, err := s.client.Stat(remotePath)
	if err != nil {
		return err
	}
	if fi.IsDir() {
		return s.client.RemoveDirectory(remotePath)
	}
	return s.client.Remove(remotePath)
}

func (s *SFTPFileSystem) Rename(ctx context.Context, from string, to string) error {
	_ = ctx
	fromP, err := normalizeRemotePath(from)
	if err != nil {
		return err
	}
	toP, err := normalizeRemotePath(to)
	if err != nil {
		return err
	}
	return s.client.Rename(fromP, toP)
}

func (s *SFTPFileSystem) OpenRead(ctx context.Context, p string) (io.ReadCloser, error) {
	_ = ctx
	remotePath, err := normalizeRemotePath(p)
	if err != nil {
		return nil, err
	}
	return s.client.Open(remotePath)
}

func (s *SFTPFileSystem) OpenWrite(ctx context.Context, p string, opts OpenWriteOptions) (io.WriteCloser, error) {
	_ = ctx
	remotePath, err := normalizeRemotePath(p)
	if err != nil {
		return nil, err
	}

	flag := os.O_WRONLY | os.O_CREATE
	if opts.Overwrite {
		flag |= os.O_TRUNC
	} else {
		flag |= os.O_EXCL
	}

	return s.client.OpenFile(remotePath, flag)
}

func (s *SFTPFileSystem) Pwd(ctx context.Context) (string, error) {
	_ = ctx
	wd, err := s.client.Getwd()
	if err != nil || strings.TrimSpace(wd) == "" {
		return "/", nil
	}
	wd = filepath.ToSlash(wd)
	if !strings.HasPrefix(wd, "/") {
		return "/", nil
	}
	return wd, nil
}

var _ FileSystem = (*SFTPFileSystem)(nil)
var _ PwdProvider = (*SFTPFileSystem)(nil)

// Replace normalizeRemotePath and joinRemote helpers with shared ones.
// Add a new pool-backed filesystem:

type SFTPEndpointFileSystem struct {
	pool    *SFTPPool
	assetID string
}

func NewSFTPEndpointFileSystem(pool *SFTPPool, assetID string) (*SFTPEndpointFileSystem, error) {
	if pool == nil {
		return nil, fmt.Errorf("sftp pool is nil")
	}
	if strings.TrimSpace(assetID) == "" {
		return nil, fmt.Errorf("asset id is empty")
	}
	return &SFTPEndpointFileSystem{pool: pool, assetID: assetID}, nil
}

func (e *SFTPEndpointFileSystem) client(ctx context.Context) (*sftp.Client, error) {
	return e.pool.GetClient(ctx, e.assetID)
}

func (e *SFTPEndpointFileSystem) ListDir(ctx context.Context, p string, opts ListDirOptions) (*ListDirResponse, error) {
	cli, err := e.client(ctx)
	if err != nil {
		return nil, err
	}
	fs, _ := NewSFTPFileSystem(cli)
	return fs.ListDir(ctx, p, opts)
}

func (e *SFTPEndpointFileSystem) Stat(ctx context.Context, p string) (*FileEntry, error) {
	cli, err := e.client(ctx)
	if err != nil {
		return nil, err
	}
	fs, _ := NewSFTPFileSystem(cli)
	return fs.Stat(ctx, p)
}

func (e *SFTPEndpointFileSystem) MkdirAll(ctx context.Context, p string) error {
	cli, err := e.client(ctx)
	if err != nil {
		return err
	}
	fs, _ := NewSFTPFileSystem(cli)
	return fs.MkdirAll(ctx, p)
}

func (e *SFTPEndpointFileSystem) Remove(ctx context.Context, p string) error {
	cli, err := e.client(ctx)
	if err != nil {
		return err
	}
	fs, _ := NewSFTPFileSystem(cli)
	return fs.Remove(ctx, p)
}

func (e *SFTPEndpointFileSystem) Rename(ctx context.Context, from string, to string) error {
	cli, err := e.client(ctx)
	if err != nil {
		return err
	}
	fs, _ := NewSFTPFileSystem(cli)
	return fs.Rename(ctx, from, to)
}

func (e *SFTPEndpointFileSystem) OpenRead(ctx context.Context, p string) (io.ReadCloser, error) {
	cli, err := e.client(ctx)
	if err != nil {
		return nil, err
	}
	fs, _ := NewSFTPFileSystem(cli)
	return fs.OpenRead(ctx, p)
}

func (e *SFTPEndpointFileSystem) OpenWrite(ctx context.Context, p string, opts OpenWriteOptions) (io.WriteCloser, error) {
	cli, err := e.client(ctx)
	if err != nil {
		return nil, err
	}
	fs, _ := NewSFTPFileSystem(cli)
	return fs.OpenWrite(ctx, p, opts)
}

func (e *SFTPEndpointFileSystem) Pwd(ctx context.Context) (string, error) {
	cli, err := e.client(ctx)
	if err != nil {
		return "", err
	}
	fs, _ := NewSFTPFileSystem(cli)
	return fs.Pwd(ctx)
}

var _ FileSystem = (*SFTPEndpointFileSystem)(nil)
var _ PwdProvider = (*SFTPEndpointFileSystem)(nil)

// joinRemote joins a directory and a base path, ensuring a single '/' separator.
func joinRemote(dir string, base string) string {
	if dir == "" {
		return "/" + strings.TrimPrefix(base, "/")
	}
	if base == "" {
		return dir
	}
	if strings.HasSuffix(dir, "/") {
		return dir + strings.TrimPrefix(base, "/")
	}
	return dir + "/" + strings.TrimPrefix(base, "/")
}
