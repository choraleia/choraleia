package fs

import (
	"bytes"
	"context"
	"fmt"
	"os/exec"
	"strings"
	"time"
)

// DockerCLI provides minimal docker interactions via the local docker binary.
//
// NOTE: This intentionally avoids adding the Docker SDK as a dependency.
// It assumes the host running choraleia has access to the docker daemon.
type DockerCLI struct {
	bin string
}

func NewDockerCLI() *DockerCLI {
	return &DockerCLI{bin: "docker"}
}

func (d *DockerCLI) Exec(ctx context.Context, container string, user string, cmd []string) (string, error) {
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

func (d *DockerCLI) EnsureAvailable(ctx context.Context) error {
	ctx, cancel := context.WithTimeout(ctx, 3*time.Second)
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
