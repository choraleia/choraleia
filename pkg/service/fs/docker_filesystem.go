package fs

import (
	"bufio"
	"bytes"
	"context"
	"fmt"
	"io"
	"os/exec"
	"path"
	"strconv"
	"strings"
	"time"

	"github.com/choraleia/choraleia/pkg/models"
)

// DockerFileSystem implements the fs.FileSystem interface for a Docker container.
//
// Path model:
//   - All UI paths must be POSIX absolute.
//   - UI path is treated as the container absolute path (no root mapping).
//
// NOTE: This assumes a Linux-like userland in the container.
type DockerFileSystem struct {
	cli       *DockerCLI
	container string
	user      string
}

func NewDockerFileSystem(cli *DockerCLI, asset *models.Asset) (*DockerFileSystem, error) {
	if asset == nil {
		return nil, fmt.Errorf("asset is nil")
	}
	if asset.Type != models.AssetTypeDocker {
		return nil, fmt.Errorf("asset is not docker")
	}

	var cfg models.DockerConfig
	if err := asset.GetTypedConfig(&cfg); err != nil {
		return nil, fmt.Errorf("decode docker config: %w", err)
	}
	if strings.TrimSpace(cfg.Container) == "" {
		return nil, fmt.Errorf("docker config: container is required")
	}

	return &DockerFileSystem{cli: cli, container: cfg.Container, user: strings.TrimSpace(cfg.User)}, nil
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

func (d *DockerFileSystem) mapToContainerPath(uiPath string) (string, error) {
	if strings.TrimSpace(uiPath) == "" {
		uiPath = "/"
	}
	if !strings.HasPrefix(uiPath, "/") {
		return "", fmt.Errorf("path must be absolute")
	}
	return normalizePosixAbs(uiPath), nil
}

func (d *DockerFileSystem) ListDir(ctx context.Context, p string, opts ListDirOptions) (*ListDirResponse, error) {
	if err := d.cli.EnsureAvailable(ctx); err != nil {
		return nil, err
	}
	cp, err := d.mapToContainerPath(p)
	if err != nil {
		return nil, err
	}
	out, err := d.cli.Exec(ctx, d.container, d.user, []string{"sh", "-lc", fmt.Sprintf("set -e; cd %s; ls -A1", shellQuote(cp))})
	if err != nil {
		return nil, err
	}

	names := splitLines(out)
	entries := make([]FileEntry, 0, len(names))
	for _, name := range names {
		if name == "" || name == "." || name == ".." {
			continue
		}
		if !opts.IncludeHidden && strings.HasPrefix(name, ".") {
			continue
		}
		childCP := normalizePosixAbs(path.Join(cp, name))
		ent, statErr := d.statContainerPath(ctx, childCP)
		if statErr != nil {
			continue
		}
		entries = append(entries, *ent)
	}

	return &ListDirResponse{Path: normalizePosixAbs(p), Entries: entries}, nil
}

func (d *DockerFileSystem) Stat(ctx context.Context, p string) (*FileEntry, error) {
	if err := d.cli.EnsureAvailable(ctx); err != nil {
		return nil, err
	}
	cp, err := d.mapToContainerPath(p)
	if err != nil {
		return nil, err
	}
	return d.statContainerPath(ctx, cp)
}

func (d *DockerFileSystem) statContainerPath(ctx context.Context, cp string) (*FileEntry, error) {
	cmd := []string{"stat", "-c", "%n\t%F\t%s\t%A\t%Y", cp}
	out, err := d.cli.Exec(ctx, d.container, d.user, cmd)
	if err != nil {
		return nil, err
	}
	line := strings.TrimSpace(out)
	parts := strings.Split(line, "\t")
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

func (d *DockerFileSystem) MkdirAll(ctx context.Context, p string) error {
	if err := d.cli.EnsureAvailable(ctx); err != nil {
		return err
	}
	cp, err := d.mapToContainerPath(p)
	if err != nil {
		return err
	}
	_, err = d.cli.Exec(ctx, d.container, d.user, []string{"mkdir", "-p", cp})
	return err
}

func (d *DockerFileSystem) Remove(ctx context.Context, p string) error {
	if err := d.cli.EnsureAvailable(ctx); err != nil {
		return err
	}
	cp, err := d.mapToContainerPath(p)
	if err != nil {
		return err
	}
	_, err = d.cli.Exec(ctx, d.container, d.user, []string{"rm", "-rf", cp})
	return err
}

func (d *DockerFileSystem) Rename(ctx context.Context, from string, to string) error {
	if err := d.cli.EnsureAvailable(ctx); err != nil {
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
	_, err = d.cli.Exec(ctx, d.container, d.user, []string{"mv", fromCP, toCP})
	return err
}

func (d *DockerFileSystem) OpenRead(ctx context.Context, p string) (io.ReadCloser, error) {
	if err := d.cli.EnsureAvailable(ctx); err != nil {
		return nil, err
	}
	cp, err := d.mapToContainerPath(p)
	if err != nil {
		return nil, err
	}

	args := []string{"exec"}
	if strings.TrimSpace(d.user) != "" {
		args = append(args, "--user", d.user)
	}
	args = append(args, d.container, "cat", cp)
	cmd := exec.CommandContext(ctx, d.cli.bin, args...)
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return nil, err
	}
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	if err := cmd.Start(); err != nil {
		return nil, err
	}

	return &cmdReadCloser{r: stdout, closeFn: func() error {
		_ = stdout.Close()
		err := cmd.Wait()
		if err != nil {
			msg := strings.TrimSpace(stderr.String())
			if msg == "" {
				msg = err.Error()
			}
			return fmt.Errorf("docker read failed: %s", msg)
		}
		return nil
	}}, nil
}

func (d *DockerFileSystem) OpenWrite(ctx context.Context, p string, opts OpenWriteOptions) (io.WriteCloser, error) {
	if err := d.cli.EnsureAvailable(ctx); err != nil {
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

	args := []string{"exec", "-i"}
	if strings.TrimSpace(d.user) != "" {
		args = append(args, "--user", d.user)
	}
	args = append(args, d.container, "sh", "-lc", script)
	cmd := exec.CommandContext(ctx, d.cli.bin, args...)

	stdin, err := cmd.StdinPipe()
	if err != nil {
		return nil, err
	}
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	cmd.Stdout = &bytes.Buffer{}

	if err := cmd.Start(); err != nil {
		_ = stdin.Close()
		return nil, err
	}

	return &cmdWriteCloser{w: stdin, closeFn: func() error {
		_ = stdin.Close()
		err := cmd.Wait()
		if err != nil {
			msg := strings.TrimSpace(stderr.String())
			if msg == "" {
				msg = err.Error()
			}
			return fmt.Errorf("docker write failed: %s", msg)
		}
		return nil
	}}, nil
}

func (d *DockerFileSystem) Pwd(ctx context.Context) (string, error) { _ = ctx; return "/", nil }

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
