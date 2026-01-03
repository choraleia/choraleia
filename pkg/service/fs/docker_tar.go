// Package fs provides filesystem abstractions for local and remote backends.
package fs

import (
	"archive/tar"
	"bytes"
	"context"
	"fmt"
	"io"
	"os/exec"
	"path"
	"strings"
	"time"

	"golang.org/x/crypto/ssh"
)

// DockerTarStreamer handles file operations using docker exec tar command.
// This streams tar directly via stdin/stdout for reliable binary file transfer.
//
// Key commands:
//   - Read:  `docker exec container tar -cf - -C /dir file` → stdout tar stream
//   - Write: `docker exec -i container tar -xf - -C /dir` ← stdin tar stream
//
// Note: ListDir and Stat still use command-based approach because tar reads file content
// even with --no-recursion flag, which is unacceptable for large files.
type DockerTarStreamer interface {
	// TarFrom creates a tar stream from container path (stdout) - includes file content
	TarFrom(ctx context.Context, container, path string) (io.ReadCloser, error)
	// TarTo extracts a tar stream to container directory (stdin)
	TarTo(ctx context.Context, container, dir string) (io.WriteCloser, error)
}

// ---------------------------------------------------------------------------
// LocalDockerTarStreamer - for local docker daemon
// ---------------------------------------------------------------------------

type LocalDockerTarStreamer struct {
	bin string
}

func NewLocalDockerTarStreamer() *LocalDockerTarStreamer {
	return &LocalDockerTarStreamer{bin: "docker"}
}

func (d *LocalDockerTarStreamer) TarFrom(ctx context.Context, container, filePath string) (io.ReadCloser, error) {
	var cmd *exec.Cmd

	// Check if this is a directory tar request (path ends with /.)
	if strings.HasSuffix(filePath, "/.") {
		// Tar entire directory contents: tar -cf - -C /dir .
		dir := strings.TrimSuffix(filePath, "/.")
		cmd = exec.CommandContext(ctx, d.bin, "exec", container, "tar", "-cf", "-", "-C", dir, ".")
	} else {
		// Tar single file: tar -cf - -C /parent filename
		dir := path.Dir(filePath)
		name := path.Base(filePath)
		cmd = exec.CommandContext(ctx, d.bin, "exec", container, "tar", "-cf", "-", "-C", dir, name)
	}

	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return nil, fmt.Errorf("failed to get stdout pipe: %w", err)
	}

	var stderr bytes.Buffer
	cmd.Stderr = &stderr

	if err := cmd.Start(); err != nil {
		return nil, fmt.Errorf("failed to start tar: %w", err)
	}

	return &cmdStreamReader{
		reader: stdout,
		cmd:    cmd,
		stderr: &stderr,
	}, nil
}

func (d *LocalDockerTarStreamer) TarTo(ctx context.Context, container, dir string) (io.WriteCloser, error) {
	// docker exec -i container tar -xf - -C /dir
	cmd := exec.CommandContext(ctx, d.bin, "exec", "-i", container, "tar", "-xf", "-", "-C", dir)
	stdin, err := cmd.StdinPipe()
	if err != nil {
		return nil, fmt.Errorf("failed to get stdin pipe: %w", err)
	}

	var stderr bytes.Buffer
	cmd.Stderr = &stderr

	if err := cmd.Start(); err != nil {
		stdin.Close()
		return nil, fmt.Errorf("failed to start tar: %w", err)
	}

	return &cmdStreamWriter{
		writer: stdin,
		cmd:    cmd,
		stderr: &stderr,
	}, nil
}

// ---------------------------------------------------------------------------
// RemoteDockerTarStreamer - for docker on remote host via SSH
// ---------------------------------------------------------------------------

type RemoteDockerTarStreamer struct {
	client *ssh.Client
	bin    string
}

func NewRemoteDockerTarStreamer(client *ssh.Client) *RemoteDockerTarStreamer {
	return &RemoteDockerTarStreamer{client: client, bin: "docker"}
}

func (d *RemoteDockerTarStreamer) TarFrom(ctx context.Context, container, filePath string) (io.ReadCloser, error) {
	session, err := d.client.NewSession()
	if err != nil {
		return nil, fmt.Errorf("failed to create SSH session: %w", err)
	}

	stdout, err := session.StdoutPipe()
	if err != nil {
		session.Close()
		return nil, fmt.Errorf("failed to get stdout pipe: %w", err)
	}

	var cmd string
	// Check if this is a directory tar request (path ends with /.)
	if strings.HasSuffix(filePath, "/.") {
		// Tar entire directory contents
		dir := strings.TrimSuffix(filePath, "/.")
		cmd = fmt.Sprintf("%s exec %s tar -cf - -C %s .",
			d.bin, shellQuote(container), shellQuote(dir))
	} else {
		// Tar single file
		dir := path.Dir(filePath)
		name := path.Base(filePath)
		cmd = fmt.Sprintf("%s exec %s tar -cf - -C %s %s",
			d.bin, shellQuote(container), shellQuote(dir), shellQuote(name))
	}

	if err := session.Start(cmd); err != nil {
		session.Close()
		return nil, fmt.Errorf("failed to start tar: %w", err)
	}

	return &sshStreamReader{
		reader:  stdout,
		session: session,
	}, nil
}

func (d *RemoteDockerTarStreamer) TarTo(ctx context.Context, container, dir string) (io.WriteCloser, error) {
	session, err := d.client.NewSession()
	if err != nil {
		return nil, fmt.Errorf("failed to create SSH session: %w", err)
	}

	stdin, err := session.StdinPipe()
	if err != nil {
		session.Close()
		return nil, fmt.Errorf("failed to get stdin pipe: %w", err)
	}

	// docker exec -i container tar -xf - -C /dir
	cmd := fmt.Sprintf("%s exec -i %s tar -xf - -C %s",
		d.bin, shellQuote(container), shellQuote(dir))
	if err := session.Start(cmd); err != nil {
		stdin.Close()
		session.Close()
		return nil, fmt.Errorf("failed to start tar: %w", err)
	}

	return &sshStreamWriter{
		writer:  stdin,
		session: session,
	}, nil
}

// ---------------------------------------------------------------------------
// Stream reader/writer helpers
// ---------------------------------------------------------------------------

type cmdStreamReader struct {
	reader io.ReadCloser
	cmd    *exec.Cmd
	stderr *bytes.Buffer
}

func (r *cmdStreamReader) Read(p []byte) (int, error) {
	return r.reader.Read(p)
}

func (r *cmdStreamReader) Close() error {
	r.reader.Close()
	if err := r.cmd.Wait(); err != nil {
		msg := strings.TrimSpace(r.stderr.String())
		if msg == "" {
			msg = err.Error()
		}
		return fmt.Errorf("tar failed: %s", msg)
	}
	return nil
}

type cmdStreamWriter struct {
	writer io.WriteCloser
	cmd    *exec.Cmd
	stderr *bytes.Buffer
}

func (w *cmdStreamWriter) Write(p []byte) (int, error) {
	return w.writer.Write(p)
}

func (w *cmdStreamWriter) Close() error {
	w.writer.Close()
	if err := w.cmd.Wait(); err != nil {
		msg := strings.TrimSpace(w.stderr.String())
		if msg == "" {
			msg = err.Error()
		}
		return fmt.Errorf("tar failed: %s", msg)
	}
	return nil
}

type sshStreamReader struct {
	reader  io.Reader
	session *ssh.Session
}

func (r *sshStreamReader) Read(p []byte) (int, error) {
	return r.reader.Read(p)
}

func (r *sshStreamReader) Close() error {
	err := r.session.Wait()
	r.session.Close()
	return err
}

type sshStreamWriter struct {
	writer  io.WriteCloser
	session *ssh.Session
}

func (w *sshStreamWriter) Write(p []byte) (int, error) {
	return w.writer.Write(p)
}

func (w *sshStreamWriter) Close() error {
	w.writer.Close()
	err := w.session.Wait()
	w.session.Close()
	return err
}

// ---------------------------------------------------------------------------
// DockerTarFileSystem - FileSystem implementation using docker exec tar
// ---------------------------------------------------------------------------

// DockerTarFileSystem implements FileSystem using docker exec tar for file I/O.
// This provides reliable binary file support via direct tar streaming.
type DockerTarFileSystem struct {
	executor  DockerExecutor    // For metadata commands (ls, mkdir, rm, stat)
	streamer  DockerTarStreamer // For file content via tar stream
	container string
	user      string
}

// NewDockerTarFileSystem creates a new DockerTarFileSystem
func NewDockerTarFileSystem(executor DockerExecutor, streamer DockerTarStreamer, container, user string) (*DockerTarFileSystem, error) {
	if strings.TrimSpace(container) == "" {
		return nil, fmt.Errorf("container is required")
	}
	return &DockerTarFileSystem{
		executor:  executor,
		streamer:  streamer,
		container: container,
		user:      strings.TrimSpace(user),
	}, nil
}

func (d *DockerTarFileSystem) ListDir(ctx context.Context, p string, opts ListDirOptions) (*ListDirResponse, error) {
	if err := d.executor.EnsureAvailable(ctx); err != nil {
		return nil, err
	}
	cp := normalizePosixAbs(p)

	// Use find + stat to get directory entries
	// Output format: name|type|size|mode|mtime (pipe-separated to avoid shell issues)
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

	return parseListDirOutput(out, cp), nil
}

func (d *DockerTarFileSystem) Stat(ctx context.Context, p string) (*FileEntry, error) {
	if err := d.executor.EnsureAvailable(ctx); err != nil {
		return nil, err
	}
	cp := normalizePosixAbs(p)

	out, err := d.executor.Exec(ctx, d.container, d.user, []string{"stat", "-c", "%n|%F|%s|%A|%Y", cp})
	if err != nil {
		return nil, err
	}

	return parseStatOutput(out, cp)
}

func (d *DockerTarFileSystem) MkdirAll(ctx context.Context, p string) error {
	if err := d.executor.EnsureAvailable(ctx); err != nil {
		return err
	}
	cp := normalizePosixAbs(p)
	_, err := d.executor.Exec(ctx, d.container, d.user, []string{"mkdir", "-p", cp})
	return err
}

func (d *DockerTarFileSystem) Remove(ctx context.Context, p string) error {
	if err := d.executor.EnsureAvailable(ctx); err != nil {
		return err
	}
	cp := normalizePosixAbs(p)
	_, err := d.executor.Exec(ctx, d.container, d.user, []string{"rm", "-rf", cp})
	return err
}

func (d *DockerTarFileSystem) Rename(ctx context.Context, from string, to string) error {
	if err := d.executor.EnsureAvailable(ctx); err != nil {
		return err
	}
	fromCP := normalizePosixAbs(from)
	toCP := normalizePosixAbs(to)
	_, err := d.executor.Exec(ctx, d.container, d.user, []string{"mv", fromCP, toCP})
	return err
}

// OpenRead streams file content from container via tar
func (d *DockerTarFileSystem) OpenRead(ctx context.Context, p string) (io.ReadCloser, error) {
	cp := normalizePosixAbs(p)

	tarStream, err := d.streamer.TarFrom(ctx, d.container, cp)
	if err != nil {
		return nil, fmt.Errorf("tar stream failed: %w", err)
	}

	// Extract file from tar
	tr := tar.NewReader(tarStream)
	_, err = tr.Next()
	if err != nil {
		tarStream.Close()
		return nil, fmt.Errorf("failed to read tar header: %w", err)
	}

	return &tarFileReader{
		reader:    tr,
		tarStream: tarStream,
	}, nil
}

// OpenWrite streams file content to container via tar
func (d *DockerTarFileSystem) OpenWrite(ctx context.Context, p string, opts OpenWriteOptions) (io.WriteCloser, error) {
	cp := normalizePosixAbs(p)
	dir := path.Dir(cp)
	filename := path.Base(cp)

	// Ensure parent directory exists
	if err := d.MkdirAll(ctx, dir); err != nil {
		return nil, fmt.Errorf("failed to create parent directory: %w", err)
	}

	// Get tar stream writer to container
	tarStream, err := d.streamer.TarTo(ctx, d.container, dir)
	if err != nil {
		return nil, fmt.Errorf("tar stream failed: %w", err)
	}

	return &tarFileWriter{
		filename:  filename,
		tarStream: tarStream,
		buffer:    &bytes.Buffer{},
	}, nil
}

func (d *DockerTarFileSystem) Pwd(ctx context.Context) (string, error) {
	return "/", nil
}

// TarDirectory implements TarStreamer interface for bulk directory transfer.
// Creates a tar stream of an entire directory (recursive).
func (d *DockerTarFileSystem) TarDirectory(ctx context.Context, dirPath string) (io.ReadCloser, error) {
	cp := normalizePosixAbs(dirPath)
	// tar -cf - -C /parent/dir . will create tar with all contents relative to dir
	return d.streamer.TarFrom(ctx, d.container, cp+"/.")
}

// UntarToDirectory implements TarStreamer interface for bulk directory transfer.
// Extracts a tar stream to a directory.
func (d *DockerTarFileSystem) UntarToDirectory(ctx context.Context, dirPath string) (io.WriteCloser, error) {
	cp := normalizePosixAbs(dirPath)
	// Ensure directory exists
	if err := d.MkdirAll(ctx, cp); err != nil {
		return nil, fmt.Errorf("failed to create directory: %w", err)
	}
	return d.streamer.TarTo(ctx, d.container, cp)
}

// Verify interface implementations
var _ FileSystem = (*DockerTarFileSystem)(nil)
var _ PwdProvider = (*DockerTarFileSystem)(nil)
var _ TarStreamer = (*DockerTarFileSystem)(nil)

// ---------------------------------------------------------------------------
// Tar file reader/writer
// ---------------------------------------------------------------------------

type tarFileReader struct {
	reader    io.Reader
	tarStream io.ReadCloser
}

func (r *tarFileReader) Read(p []byte) (int, error) {
	return r.reader.Read(p)
}

func (r *tarFileReader) Close() error {
	return r.tarStream.Close()
}

// tarFileWriter buffers content and writes as tar on close
type tarFileWriter struct {
	filename  string
	tarStream io.WriteCloser
	buffer    *bytes.Buffer
}

func (w *tarFileWriter) Write(p []byte) (int, error) {
	return w.buffer.Write(p)
}

func (w *tarFileWriter) Close() error {
	// Create tar with the buffered content
	tw := tar.NewWriter(w.tarStream)

	hdr := &tar.Header{
		Name:    w.filename,
		Mode:    0644,
		Size:    int64(w.buffer.Len()),
		ModTime: time.Now(),
	}

	if err := tw.WriteHeader(hdr); err != nil {
		w.tarStream.Close()
		return fmt.Errorf("failed to write tar header: %w", err)
	}

	if _, err := tw.Write(w.buffer.Bytes()); err != nil {
		w.tarStream.Close()
		return fmt.Errorf("failed to write tar content: %w", err)
	}

	if err := tw.Close(); err != nil {
		w.tarStream.Close()
		return fmt.Errorf("failed to close tar: %w", err)
	}

	return w.tarStream.Close()
}

// ---------------------------------------------------------------------------
// Helper functions for parsing stat command output
// ---------------------------------------------------------------------------

func parseListDirOutput(out, basePath string) *ListDirResponse {
	lines := strings.Split(strings.ReplaceAll(out, "\r\n", "\n"), "\n")
	entries := make([]FileEntry, 0, len(lines))

	for _, line := range lines {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		entry, err := parseStatLine(line, basePath)
		if err != nil {
			continue
		}
		entries = append(entries, *entry)
	}

	return &ListDirResponse{Path: basePath, Entries: entries}
}

func parseStatOutput(out, filePath string) (*FileEntry, error) {
	line := strings.TrimSpace(out)
	return parseStatLine(line, path.Dir(filePath))
}

func parseStatLine(line, basePath string) (*FileEntry, error) {
	parts := strings.Split(line, "|")
	if len(parts) < 5 {
		return nil, fmt.Errorf("invalid stat output: %s", line)
	}

	// parts[0] is "./name" or full path, extract name
	name := strings.TrimPrefix(parts[0], "./")
	name = path.Base(name)
	if name == "" || name == "." || name == ".." {
		return nil, fmt.Errorf("skip special entry")
	}

	// parts[1] is file type from %F
	fileType := strings.ToLower(parts[1])
	isDir := strings.Contains(fileType, "directory")

	// parts[2] is size
	var size int64
	fmt.Sscanf(parts[2], "%d", &size)

	// parts[3] is mode string from %A (e.g., "-rw-r--r--")
	mode := parts[3]

	// parts[4] is mtime as unix timestamp from %Y
	var epoch int64
	fmt.Sscanf(parts[4], "%d", &epoch)
	modTime := time.Unix(epoch, 0)

	return &FileEntry{
		Name:    name,
		Path:    normalizePosixAbs(path.Join(basePath, name)),
		IsDir:   isDir,
		Size:    size,
		Mode:    mode,
		ModTime: modTime,
	}, nil
}

// ---------------------------------------------------------------------------
// Path and shell helper functions
// ---------------------------------------------------------------------------

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

func shellQuote(s string) string {
	if s == "" {
		return "''"
	}
	return "'" + strings.ReplaceAll(s, "'", "'\\''") + "'"
}
