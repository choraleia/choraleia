package fs

import (
	"bufio"
	"context"
	"fmt"
	"io"
	"path"
	"strconv"
	"strings"
	"time"
)

// DockerContainerFileSystem implements the fs.FileSystem interface for a Docker container.
//
// Path model:
//   - All UI paths must be POSIX absolute.
//   - UI path is treated as the container absolute path (no root mapping).
//
// NOTE: This assumes a Linux-like userland in the container.
type DockerContainerFileSystem struct {
	executor  DockerExecutor
	container string
	user      string
}

// NewDockerContainerFileSystem creates a DockerContainerFileSystem for a specific container
func NewDockerContainerFileSystem(executor DockerExecutor, container, user string) (*DockerContainerFileSystem, error) {
	if strings.TrimSpace(container) == "" {
		return nil, fmt.Errorf("container is required")
	}
	return &DockerContainerFileSystem{executor: executor, container: container, user: strings.TrimSpace(user)}, nil
}

func normalizePosixAbs(p string) string {
	if p == "" {
		return "/"
	}
	p = strings.ReplaceAll(p, "\\", "/")
	if !strings.HasPrefix(p, "/") {
		p = "/" + p
	}
	p = path.Clean(p)
	if p == "." {
		return "/"
	}
	return p
}

func (d *DockerContainerFileSystem) mapToContainerPath(uiPath string) (string, error) {
	if strings.TrimSpace(uiPath) == "" {
		uiPath = "/"
	}
	if !strings.HasPrefix(uiPath, "/") {
		return "", fmt.Errorf("path must be absolute")
	}
	return normalizePosixAbs(uiPath), nil
}

func (d *DockerContainerFileSystem) ListDir(ctx context.Context, p string, opts ListDirOptions) (*ListDirResponse, error) {
	if err := d.executor.EnsureAvailable(ctx); err != nil {
		return nil, err
	}
	cp, err := d.mapToContainerPath(p)
	if err != nil {
		return nil, err
	}

	// Use a single command to get all file info at once
	// Format: name|type|size|mode|mtime (one file per line)
	// Use pipe separator to avoid shell quoting issues with \t
	// Use find + stat to get all entries in one command
	var script string
	if opts.IncludeHidden {
		script = fmt.Sprintf("cd %s && find . -maxdepth 1 ! -name . -exec stat -c '%%n|%%F|%%s|%%A|%%Y' {} \\;", shellQuote(cp))
	} else {
		script = fmt.Sprintf("cd %s && find . -maxdepth 1 ! -name . ! -name '.*' -exec stat -c '%%n|%%F|%%s|%%A|%%Y' {} \\;", shellQuote(cp))
	}

	out, err := d.executor.Exec(ctx, d.container, d.user, []string{"sh", "-c", script})
	if err != nil {
		return nil, err
	}

	lines := splitLines(out)
	entries := make([]FileEntry, 0, len(lines))
	for _, line := range lines {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		parts := strings.Split(line, "|")
		if len(parts) < 5 {
			continue
		}
		// parts[0] is like "./filename", strip the "./"
		name := strings.TrimPrefix(parts[0], "./")
		if name == "" || name == "." || name == ".." {
			continue
		}
		fileType := parts[1]
		isDir := strings.Contains(strings.ToLower(fileType), "directory")
		sz, _ := strconv.ParseInt(parts[2], 10, 64)
		mode := parts[3]
		epoch, _ := strconv.ParseInt(parts[4], 10, 64)
		mtime := time.Unix(epoch, 0)

		entries = append(entries, FileEntry{
			Name:    name,
			Path:    normalizePosixAbs(path.Join(cp, name)),
			IsDir:   isDir,
			Size:    sz,
			Mode:    mode,
			ModTime: mtime,
		})
	}

	return &ListDirResponse{Path: normalizePosixAbs(p), Entries: entries}, nil
}

func (d *DockerContainerFileSystem) Stat(ctx context.Context, p string) (*FileEntry, error) {
	if err := d.executor.EnsureAvailable(ctx); err != nil {
		return nil, err
	}
	cp, err := d.mapToContainerPath(p)
	if err != nil {
		return nil, err
	}
	return d.statContainerPath(ctx, cp)
}

func (d *DockerContainerFileSystem) statContainerPath(ctx context.Context, cp string) (*FileEntry, error) {
	cmd := []string{"stat", "-c", "%n|%F|%s|%A|%Y", cp}
	out, err := d.executor.Exec(ctx, d.container, d.user, cmd)
	if err != nil {
		return nil, err
	}
	line := strings.TrimSpace(out)
	parts := strings.Split(line, "|")
	if len(parts) < 5 {
		return nil, fmt.Errorf("docker stat parse failed")
	}
	name := path.Base(parts[0])
	fileType := parts[1]
	isDir := strings.Contains(strings.ToLower(fileType), "directory")
	sz, _ := strconv.ParseInt(parts[2], 10, 64)
	mode := parts[3]
	epoch, _ := strconv.ParseInt(parts[4], 10, 64)
	mtime := time.Unix(epoch, 0)

	return &FileEntry{Name: name, Path: normalizePosixAbs(parts[0]), IsDir: isDir, Size: sz, Mode: mode, ModTime: mtime}, nil
}

func (d *DockerContainerFileSystem) MkdirAll(ctx context.Context, p string) error {
	if err := d.executor.EnsureAvailable(ctx); err != nil {
		return err
	}
	cp, err := d.mapToContainerPath(p)
	if err != nil {
		return err
	}
	_, err = d.executor.Exec(ctx, d.container, d.user, []string{"mkdir", "-p", cp})
	return err
}

func (d *DockerContainerFileSystem) Remove(ctx context.Context, p string) error {
	if err := d.executor.EnsureAvailable(ctx); err != nil {
		return err
	}
	cp, err := d.mapToContainerPath(p)
	if err != nil {
		return err
	}
	_, err = d.executor.Exec(ctx, d.container, d.user, []string{"rm", "-rf", cp})
	return err
}

func (d *DockerContainerFileSystem) Rename(ctx context.Context, from string, to string) error {
	if err := d.executor.EnsureAvailable(ctx); err != nil {
		return err
	}
	fromCP, err := d.mapToContainerPath(from)
	if err != nil {
		return err
	}
	toCP, err := d.mapToContainerPath(to)
	if err != nil {
		return err
	}
	_, err = d.executor.Exec(ctx, d.container, d.user, []string{"mv", fromCP, toCP})
	return err
}

func (d *DockerContainerFileSystem) OpenRead(ctx context.Context, p string) (io.ReadCloser, error) {
	if err := d.executor.EnsureAvailable(ctx); err != nil {
		return nil, err
	}
	cp, err := d.mapToContainerPath(p)
	if err != nil {
		return nil, err
	}

	stdout, _, waitFn, err := d.executor.ExecStream(ctx, d.container, d.user, []string{"cat", cp})
	if err != nil {
		return nil, err
	}

	return &cmdReadCloser{r: stdout, closeFn: func() error {
		_ = stdout.Close()
		return waitFn()
	}}, nil
}

func (d *DockerContainerFileSystem) OpenWrite(ctx context.Context, p string, opts OpenWriteOptions) (io.WriteCloser, error) {
	if err := d.executor.EnsureAvailable(ctx); err != nil {
		return nil, err
	}
	cp, err := d.mapToContainerPath(p)
	if err != nil {
		return nil, err
	}

	script := "set -e; "
	if !opts.Overwrite {
		script += fmt.Sprintf("[ ! -e %s ]; ", shellQuote(cp))
	}
	script += fmt.Sprintf("cat > %s", shellQuote(cp))

	_, stdin, waitFn, err := d.executor.ExecStream(ctx, d.container, d.user, []string{"sh", "-c", script})
	if err != nil {
		return nil, err
	}

	return &cmdWriteCloser{w: stdin, closeFn: func() error {
		_ = stdin.Close()
		return waitFn()
	}}, nil
}

func (d *DockerContainerFileSystem) Pwd(ctx context.Context) (string, error) {
	_ = ctx
	return "/", nil
}

type cmdReadCloser struct {
	r       io.ReadCloser
	closeFn func() error
}

func (c *cmdReadCloser) Read(p []byte) (int, error) { return c.r.Read(p) }
func (c *cmdReadCloser) Close() error               { return c.closeFn() }

type cmdWriteCloser struct {
	w       io.WriteCloser
	closeFn func() error
}

func (c *cmdWriteCloser) Write(p []byte) (int, error) { return c.w.Write(p) }
func (c *cmdWriteCloser) Close() error                { return c.closeFn() }

func splitLines(s string) []string {
	s = strings.ReplaceAll(s, "\r\n", "\n")
	s = strings.ReplaceAll(s, "\r", "\n")
	out := make([]string, 0, 16)
	sc := bufio.NewScanner(strings.NewReader(s))
	for sc.Scan() {
		out = append(out, sc.Text())
	}
	return out
}

func shellQuote(s string) string {
	if s == "" {
		return "''"
	}
	return "'" + strings.ReplaceAll(s, "'", "'\\''") + "'"
}
