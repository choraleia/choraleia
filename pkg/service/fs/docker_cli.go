package fs

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"os/exec"
	"strings"
	"time"

	"golang.org/x/crypto/ssh"
)

// DockerExecutor defines the interface for executing docker commands.
// Implementations can be local (via docker CLI) or remote (via SSH).
type DockerExecutor interface {
	Exec(ctx context.Context, container string, user string, cmd []string) (string, error)
	ExecStream(ctx context.Context, container string, user string, cmd []string) (io.ReadCloser, io.WriteCloser, func() error, error)
	EnsureAvailable(ctx context.Context) error
}

// LocalDockerCLI executes docker commands on the local machine.
type LocalDockerCLI struct {
	bin string
}

// NewLocalDockerCLI creates a local docker executor.
func NewLocalDockerCLI() *LocalDockerCLI {
	return &LocalDockerCLI{bin: "docker"}
}

func (d *LocalDockerCLI) Exec(ctx context.Context, container string, user string, cmd []string) (string, error) {
	args := []string{"exec"}
	if strings.TrimSpace(user) != "" {
		args = append(args, "--user", user)
	}
	args = append(args, container)
	args = append(args, cmd...)

	c := exec.CommandContext(ctx, d.bin, args...)
	var out bytes.Buffer
	var stderr bytes.Buffer
	c.Stdout = &out
	c.Stderr = &stderr
	if err := c.Run(); err != nil {
		msg := strings.TrimSpace(stderr.String())
		if msg == "" {
			msg = strings.TrimSpace(out.String())
		}
		if msg == "" {
			msg = err.Error()
		}
		return "", fmt.Errorf("docker exec failed: %s", msg)
	}
	return out.String(), nil
}

func (d *LocalDockerCLI) ExecStream(ctx context.Context, container string, user string, cmd []string) (io.ReadCloser, io.WriteCloser, func() error, error) {
	args := []string{"exec", "-i"}
	if strings.TrimSpace(user) != "" {
		args = append(args, "--user", user)
	}
	args = append(args, container)
	args = append(args, cmd...)

	c := exec.CommandContext(ctx, d.bin, args...)
	stdout, err := c.StdoutPipe()
	if err != nil {
		return nil, nil, nil, fmt.Errorf("failed to get stdout pipe: %w", err)
	}
	stdin, err := c.StdinPipe()
	if err != nil {
		return nil, nil, nil, fmt.Errorf("failed to get stdin pipe: %w", err)
	}
	var stderr bytes.Buffer
	c.Stderr = &stderr

	if err := c.Start(); err != nil {
		return nil, nil, nil, fmt.Errorf("failed to start command: %w", err)
	}

	waitFn := func() error {
		err := c.Wait()
		if err != nil {
			msg := strings.TrimSpace(stderr.String())
			if msg == "" {
				msg = err.Error()
			}
			return fmt.Errorf("docker exec failed: %s", msg)
		}
		return nil
	}

	return stdout, stdin, waitFn, nil
}

func (d *LocalDockerCLI) EnsureAvailable(ctx context.Context) error {
	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	c := exec.CommandContext(ctx, d.bin, "version", "--format", "{{.Server.Version}}")
	var stderr bytes.Buffer
	c.Stdout = &bytes.Buffer{}
	c.Stderr = &stderr
	if err := c.Run(); err != nil {
		msg := strings.TrimSpace(stderr.String())
		if msg == "" {
			msg = err.Error()
		}
		return fmt.Errorf("docker is not available: %s", msg)
	}
	return nil
}

// RemoteDockerCLI executes docker commands on a remote machine via SSH.
type RemoteDockerCLI struct {
	sshClient *ssh.Client
	bin       string
}

// NewRemoteDockerCLI creates a remote docker executor using an existing SSH client.
func NewRemoteDockerCLI(sshClient *ssh.Client) *RemoteDockerCLI {
	return &RemoteDockerCLI{sshClient: sshClient, bin: "docker"}
}

func (d *RemoteDockerCLI) Exec(ctx context.Context, container string, user string, cmd []string) (string, error) {
	session, err := d.sshClient.NewSession()
	if err != nil {
		return "", fmt.Errorf("failed to create SSH session: %w", err)
	}
	defer session.Close()

	// Build docker exec command with proper shell quoting
	args := []string{d.bin, "exec"}
	if strings.TrimSpace(user) != "" {
		args = append(args, "--user", shellQuote(user))
	}
	args = append(args, container)
	for _, c := range cmd {
		args = append(args, shellQuote(c))
	}

	cmdStr := strings.Join(args, " ")

	var out bytes.Buffer
	var stderr bytes.Buffer
	session.Stdout = &out
	session.Stderr = &stderr

	err = session.Run(cmdStr)

	if err != nil {
		msg := strings.TrimSpace(stderr.String())
		if msg == "" {
			msg = strings.TrimSpace(out.String())
		}
		if msg == "" {
			msg = err.Error()
		}
		return "", fmt.Errorf("docker exec failed: %s", msg)
	}

	return out.String(), nil
}

func (d *RemoteDockerCLI) EnsureAvailable(ctx context.Context) error {
	// Create a timeout context if not already set
	if _, hasDeadline := ctx.Deadline(); !hasDeadline {
		var cancel context.CancelFunc
		ctx, cancel = context.WithTimeout(ctx, 10*time.Second)
		defer cancel()
	}

	session, err := d.sshClient.NewSession()
	if err != nil {
		return fmt.Errorf("failed to create SSH session: %w", err)
	}
	defer session.Close()

	var stderr bytes.Buffer
	session.Stdout = &bytes.Buffer{}
	session.Stderr = &stderr

	cmdStr := d.bin + " version --format '{{.Server.Version}}'"

	// Use a channel to handle timeout
	done := make(chan error, 1)
	go func() {
		done <- session.Run(cmdStr)
	}()

	select {
	case <-ctx.Done():
		_ = session.Close()
		return fmt.Errorf("docker availability check timed out: %w", ctx.Err())
	case err := <-done:
		if err != nil {
			msg := strings.TrimSpace(stderr.String())
			if msg == "" {
				msg = err.Error()
			}
			return fmt.Errorf("docker is not available on remote: %s", msg)
		}
		return nil
	}
}

func (d *RemoteDockerCLI) ExecStream(ctx context.Context, container string, user string, cmd []string) (io.ReadCloser, io.WriteCloser, func() error, error) {
	session, err := d.sshClient.NewSession()
	if err != nil {
		return nil, nil, nil, fmt.Errorf("failed to create SSH session: %w", err)
	}

	// Build docker exec command with proper shell quoting
	args := []string{d.bin, "exec", "-i"}
	if strings.TrimSpace(user) != "" {
		args = append(args, "--user", shellQuote(user))
	}
	args = append(args, container)
	for _, c := range cmd {
		args = append(args, shellQuote(c))
	}
	cmdStr := strings.Join(args, " ")

	stdout, err := session.StdoutPipe()
	if err != nil {
		session.Close()
		return nil, nil, nil, fmt.Errorf("failed to get stdout pipe: %w", err)
	}
	stdin, err := session.StdinPipe()
	if err != nil {
		session.Close()
		return nil, nil, nil, fmt.Errorf("failed to get stdin pipe: %w", err)
	}

	if err := session.Start(cmdStr); err != nil {
		session.Close()
		return nil, nil, nil, fmt.Errorf("failed to start command: %w", err)
	}

	waitFn := func() error {
		err := session.Wait()
		session.Close()
		return err
	}

	return io.NopCloser(stdout), stdin, waitFn, nil
}
