package service

import (
	"bytes"
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"log/slog"

	"github.com/choraleia/choraleia/pkg/models"
	"github.com/choraleia/choraleia/pkg/service/fs"
	"github.com/choraleia/choraleia/pkg/utils"
)

// RuntimeManager manages workspace runtime environments
type RuntimeManager struct {
	dockerService *DockerService
	assetService  *AssetService
	sshPool       *fs.SSHPool
	statusService *RuntimeStatusService
	containers    map[string]*ContainerInfo
	mu            sync.RWMutex
	logger        *slog.Logger
	// Callback to update container ID/name in database
	onContainerCreated func(workspaceID, containerID, containerName string) error
}

// ContainerInfo stores information about a running container
type ContainerInfo struct {
	ContainerID   string
	ContainerName string
	WorkspaceID   string
	Status        string
	StartedAt     int64
	Image         string
	IsManaged     bool // true if we created the container
}

// NewRuntimeManager creates a new RuntimeManager
func NewRuntimeManager() *RuntimeManager {
	return &RuntimeManager{
		containers: make(map[string]*ContainerInfo),
		logger:     utils.GetLogger(),
	}
}

// SetDockerService sets the docker service
func (m *RuntimeManager) SetDockerService(ds *DockerService) {
	m.dockerService = ds
	if ds != nil {
		m.assetService = ds.assetService
	}
}

// SetAssetService sets the asset service directly
func (m *RuntimeManager) SetAssetService(as *AssetService) {
	m.assetService = as
}

// SetSSHPool sets the SSH pool
func (m *RuntimeManager) SetSSHPool(pool *fs.SSHPool) {
	m.sshPool = pool
}

// SetStatusService sets the runtime status service
func (m *RuntimeManager) SetStatusService(ss *RuntimeStatusService) {
	m.statusService = ss
}

// SetOnContainerCreated sets the callback for when a container is created
func (m *RuntimeManager) SetOnContainerCreated(fn func(workspaceID, containerID, containerName string) error) {
	m.onContainerCreated = fn
}

// StartRuntime starts the runtime for a workspace
func (m *RuntimeManager) StartRuntime(ctx context.Context, workspace *models.Workspace) error {
	if workspace.Runtime == nil {
		return nil
	}

	switch workspace.Runtime.Type {
	case models.RuntimeTypeLocal:
		// Local runtime doesn't need to start anything
		if m.statusService != nil {
			m.statusService.SetRunning(workspace.ID, "local")
		}
		return nil

	case models.RuntimeTypeDockerLocal:
		return m.startDockerLocalRuntime(ctx, workspace)

	case models.RuntimeTypeDockerRemote:
		return m.startDockerRemoteRuntime(ctx, workspace)

	default:
		return fmt.Errorf("unsupported runtime type: %s", workspace.Runtime.Type)
	}
}

// startDockerLocalRuntime starts a local Docker container
func (m *RuntimeManager) startDockerLocalRuntime(ctx context.Context, workspace *models.Workspace) error {
	if m.dockerService == nil {
		return fmt.Errorf("docker service not available")
	}

	runtime := workspace.Runtime
	var containerID string
	var containerName string
	var err error

	if runtime.ContainerMode != nil && *runtime.ContainerMode == models.ContainerModeNew {
		// Create new container
		if runtime.NewContainerImage == nil || *runtime.NewContainerImage == "" {
			return fmt.Errorf("container image is required for new container")
		}
		containerID, containerName, err = m.createAndStartContainer(ctx, workspace, nil)
	} else {
		// Use existing container
		if runtime.ContainerID == nil || *runtime.ContainerID == "" {
			return fmt.Errorf("container ID is required for existing container")
		}
		containerID = *runtime.ContainerID
		containerName = containerID[:12] // Use short ID as name
		err = m.startExistingContainer(ctx, workspace, nil, containerID)
	}

	if err != nil {
		if m.statusService != nil {
			m.statusService.SetError(workspace.ID, err)
		}
		return err
	}

	// Store container info
	m.mu.Lock()
	m.containers[workspace.ID] = &ContainerInfo{
		ContainerID:   containerID,
		ContainerName: containerName,
		WorkspaceID:   workspace.ID,
		Status:        "running",
		StartedAt:     time.Now().Unix(),
		Image:         getStringPtr(runtime.NewContainerImage),
		IsManaged:     runtime.ContainerMode != nil && *runtime.ContainerMode == models.ContainerModeNew,
	}
	m.mu.Unlock()

	// Save container ID and name to database (for new containers)
	if m.onContainerCreated != nil && runtime.ContainerMode != nil && *runtime.ContainerMode == models.ContainerModeNew {
		if err := m.onContainerCreated(workspace.ID, containerID, containerName); err != nil {
			m.logger.Warn("Failed to save container info to database", "error", err)
		}
	}

	if m.statusService != nil {
		m.statusService.SetRunning(workspace.ID, containerID)
		m.statusService.SetContainerInfo(workspace.ID, containerID, containerName, getStringPtr(runtime.NewContainerImage))
	}

	return nil
}

// startDockerRemoteRuntime starts a Docker container on a remote host via SSH
func (m *RuntimeManager) startDockerRemoteRuntime(ctx context.Context, workspace *models.Workspace) error {
	if m.dockerService == nil {
		return fmt.Errorf("docker service not available")
	}

	runtime := workspace.Runtime
	if runtime.DockerAssetID == nil || *runtime.DockerAssetID == "" {
		return fmt.Errorf("docker asset ID is required for remote docker runtime")
	}

	// Get the docker host asset
	dockerAsset, err := m.assetService.GetAsset(*runtime.DockerAssetID)
	if err != nil {
		return fmt.Errorf("failed to get docker host asset: %w", err)
	}

	var cfg models.DockerHostConfig
	if err := dockerAsset.GetTypedConfig(&cfg); err != nil {
		return fmt.Errorf("invalid docker host config: %w", err)
	}

	// The docker host must be configured with SSH
	if cfg.ConnectionType != "ssh" || cfg.SSHAssetID == "" {
		return fmt.Errorf("remote docker runtime requires SSH connection type")
	}

	var containerID string
	var containerName string

	if runtime.ContainerMode != nil && *runtime.ContainerMode == models.ContainerModeNew {
		// Create new container on remote host
		if runtime.NewContainerImage == nil || *runtime.NewContainerImage == "" {
			return fmt.Errorf("container image is required for new container")
		}
		containerID, containerName, err = m.createAndStartContainer(ctx, workspace, dockerAsset)
	} else {
		// Use existing container on remote host
		if runtime.ContainerID == nil || *runtime.ContainerID == "" {
			return fmt.Errorf("container ID is required for existing container")
		}
		containerID = *runtime.ContainerID
		containerName = containerID[:min(12, len(containerID))]
		err = m.startExistingContainer(ctx, workspace, dockerAsset, containerID)
	}

	if err != nil {
		if m.statusService != nil {
			m.statusService.SetError(workspace.ID, err)
		}
		return err
	}

	// Store container info
	m.mu.Lock()
	m.containers[workspace.ID] = &ContainerInfo{
		ContainerID:   containerID,
		ContainerName: containerName,
		WorkspaceID:   workspace.ID,
		Status:        "running",
		StartedAt:     time.Now().Unix(),
		Image:         getStringPtr(runtime.NewContainerImage),
		IsManaged:     runtime.ContainerMode != nil && *runtime.ContainerMode == models.ContainerModeNew,
	}
	m.mu.Unlock()

	// Save container ID and name to database (for new containers)
	if m.onContainerCreated != nil && runtime.ContainerMode != nil && *runtime.ContainerMode == models.ContainerModeNew {
		if err := m.onContainerCreated(workspace.ID, containerID, containerName); err != nil {
			m.logger.Warn("Failed to save container info to database", "error", err)
		}
	}

	if m.statusService != nil {
		m.statusService.SetRunning(workspace.ID, containerID)
		m.statusService.SetContainerInfo(workspace.ID, containerID, containerName, getStringPtr(runtime.NewContainerImage))
	}

	return nil
}

// createAndStartContainer creates and starts a new container
// If dockerAsset is nil, it runs locally; otherwise it runs on the remote docker host
func (m *RuntimeManager) createAndStartContainer(ctx context.Context, workspace *models.Workspace, dockerAsset *models.Asset) (string, string, error) {
	runtime := workspace.Runtime
	image := *runtime.NewContainerImage

	// Generate container name
	containerName := fmt.Sprintf("choraleia-%s", workspace.Name)
	if runtime.NewContainerName != nil && *runtime.NewContainerName != "" {
		containerName = *runtime.NewContainerName
	}

	// Update status: pulling image
	if m.statusService != nil {
		m.statusService.UpdateStatus(workspace.ID, RuntimePhasePulling, fmt.Sprintf("Pulling image: %s", image))
		m.statusService.SetProgress(workspace.ID, 10, "Pulling image...")
	}

	// Pull image first
	pullArgs := []string{"pull", image}
	if _, err := m.execDocker(ctx, dockerAsset, pullArgs...); err != nil {
		// Image might already exist locally, continue
		m.logger.Debug("Image pull failed, might already exist", "image", image, "error", err)
	}

	if m.statusService != nil {
		m.statusService.UpdateStatus(workspace.ID, RuntimePhaseCreating, "Creating container...")
		m.statusService.SetProgress(workspace.ID, 50, "Creating container...")
	}

	// Check if container with same name already exists and remove it
	inspectOutput, err := m.execDocker(ctx, dockerAsset, "inspect", "-f", "{{.Id}}", containerName)
	if err == nil && strings.TrimSpace(inspectOutput) != "" {
		// Container exists, check if it's managed by choraleia for this workspace
		labelOutput, _ := m.execDocker(ctx, dockerAsset, "inspect", "-f", "{{index .Config.Labels \"workspace-id\"}}", containerName)
		existingWorkspaceID := strings.TrimSpace(labelOutput)

		if existingWorkspaceID == workspace.ID {
			// Same workspace, remove the old container
			m.logger.Info("Removing existing container for workspace", "containerName", containerName, "workspaceID", workspace.ID)
			if _, err := m.execDocker(ctx, dockerAsset, "rm", "-f", containerName); err != nil {
				return "", "", fmt.Errorf("failed to remove existing container: %w", err)
			}
		} else {
			// Different workspace or not managed by choraleia, generate unique name
			containerName = fmt.Sprintf("%s-%s", containerName, workspace.ID[:8])
			m.logger.Info("Container name conflict, using unique name", "containerName", containerName)
		}
	}

	// Build docker create command
	createArgs := []string{"create", "--name", containerName}

	// Add labels
	createArgs = append(createArgs, "--label", "managed-by=choraleia")
	createArgs = append(createArgs, "--label", fmt.Sprintf("workspace-id=%s", workspace.ID))
	createArgs = append(createArgs, "--label", fmt.Sprintf("workspace-name=%s", workspace.Name))

	// Add volume mount for work directory
	if runtime.WorkDirPath != "" {
		// Expand ~ to absolute path (Docker requires absolute paths)
		hostPath := expandPath(runtime.WorkDirPath)

		// Ensure the directory exists
		if dockerAsset == nil {
			// Local docker - create directory if needed
			if err := os.MkdirAll(hostPath, 0755); err != nil {
				m.logger.Warn("Failed to create work directory", "path", hostPath, "error", err)
			}
		}

		containerPath := "/workspace"
		if runtime.WorkDirContainerPath != nil && *runtime.WorkDirContainerPath != "" {
			containerPath = *runtime.WorkDirContainerPath
		}
		createArgs = append(createArgs, "-v", fmt.Sprintf("%s:%s", hostPath, containerPath))
	}

	// Add interactive and tty flags
	createArgs = append(createArgs, "-it")

	// Add image
	createArgs = append(createArgs, image)

	// Execute create command
	output, err := m.execDocker(ctx, dockerAsset, createArgs...)
	if err != nil {
		return "", "", fmt.Errorf("failed to create container: %w", err)
	}

	containerID := strings.TrimSpace(output)
	if containerID == "" {
		return "", "", fmt.Errorf("failed to get container ID from create output")
	}

	if m.statusService != nil {
		m.statusService.UpdateStatus(workspace.ID, RuntimePhaseStarting, "Starting container...")
		m.statusService.SetProgress(workspace.ID, 80, "Starting container...")
	}

	// Start the container
	if _, err := m.execDocker(ctx, dockerAsset, "start", containerID); err != nil {
		// Clean up: remove the created container
		_, _ = m.execDocker(ctx, dockerAsset, "rm", "-f", containerID)
		return "", "", fmt.Errorf("failed to start container: %w", err)
	}

	if m.statusService != nil {
		m.statusService.SetProgress(workspace.ID, 100, "Container started")
	}

	return containerID, containerName, nil
}

// startExistingContainer starts an existing container
func (m *RuntimeManager) startExistingContainer(ctx context.Context, workspace *models.Workspace, dockerAsset *models.Asset, containerID string) error {
	if m.statusService != nil {
		m.statusService.UpdateStatus(workspace.ID, RuntimePhaseStarting, fmt.Sprintf("Starting container: %s", containerID[:min(12, len(containerID))]))
	}

	// Check if container exists and is running
	output, err := m.execDocker(ctx, dockerAsset, "inspect", "-f", "{{.State.Running}}", containerID)
	if err != nil {
		return fmt.Errorf("container not found: %w", err)
	}

	isRunning := strings.TrimSpace(output) == "true"
	if isRunning {
		// Already running, nothing to do
		return nil
	}

	// Start the container
	if _, err := m.execDocker(ctx, dockerAsset, "start", containerID); err != nil {
		return fmt.Errorf("failed to start container: %w", err)
	}

	return nil
}

// StopRuntime stops the runtime for a workspace
func (m *RuntimeManager) StopRuntime(ctx context.Context, workspace *models.Workspace) error {
	if workspace.Runtime == nil {
		return nil
	}

	m.mu.Lock()
	info, exists := m.containers[workspace.ID]
	if exists {
		delete(m.containers, workspace.ID)
	}
	m.mu.Unlock()

	if !exists {
		return nil
	}

	if m.statusService != nil {
		m.statusService.UpdateStatus(workspace.ID, RuntimePhaseStopping, "Stopping container...")
	}

	switch workspace.Runtime.Type {
	case models.RuntimeTypeLocal:
		if m.statusService != nil {
			m.statusService.SetStopped(workspace.ID)
		}
		return nil

	case models.RuntimeTypeDockerLocal:
		err := m.stopDockerContainer(ctx, workspace, nil, info)
		if m.statusService != nil {
			if err != nil {
				m.statusService.SetError(workspace.ID, err)
			} else {
				m.statusService.SetStopped(workspace.ID)
			}
		}
		return err

	case models.RuntimeTypeDockerRemote:
		var dockerAsset *models.Asset
		if workspace.Runtime.DockerAssetID != nil {
			var err error
			dockerAsset, err = m.assetService.GetAsset(*workspace.Runtime.DockerAssetID)
			if err != nil {
				return fmt.Errorf("failed to get docker host asset: %w", err)
			}
		}
		err := m.stopDockerContainer(ctx, workspace, dockerAsset, info)
		if m.statusService != nil {
			if err != nil {
				m.statusService.SetError(workspace.ID, err)
			} else {
				m.statusService.SetStopped(workspace.ID)
			}
		}
		return err

	default:
		if m.statusService != nil {
			m.statusService.SetStopped(workspace.ID)
		}
		return nil
	}
}

// stopDockerContainer stops a docker container
func (m *RuntimeManager) stopDockerContainer(ctx context.Context, workspace *models.Workspace, dockerAsset *models.Asset, info *ContainerInfo) error {
	if info == nil {
		return nil
	}

	// Only stop if we manage the container
	if info.IsManaged {
		// Stop the container
		if _, err := m.execDocker(ctx, dockerAsset, "stop", info.ContainerID); err != nil {
			return fmt.Errorf("failed to stop container: %w", err)
		}

		// Optionally remove the container
		// For now, we keep it for debugging purposes
		// _, _ = m.execDocker(ctx, dockerAsset, "rm", info.ContainerID)
	}

	return nil
}

// GetRuntimeStatus gets the runtime status for a workspace
func (m *RuntimeManager) GetRuntimeStatus(ctx context.Context, workspace *models.Workspace) (*RuntimeStatusInfo, error) {
	if workspace.Runtime == nil {
		return nil, nil
	}

	status := &RuntimeStatusInfo{
		Type: workspace.Runtime.Type,
	}

	m.mu.RLock()
	info, exists := m.containers[workspace.ID]
	m.mu.RUnlock()

	if exists {
		status.ContainerID = info.ContainerID
		status.ContainerStatus = info.Status
		status.Uptime = time.Now().Unix() - info.StartedAt
	}

	return status, nil
}

// GetDetailedStatus gets detailed runtime status
func (m *RuntimeManager) GetDetailedStatus(workspaceID string) *RuntimeDetailedStatus {
	if m.statusService != nil {
		return m.statusService.GetStatus(workspaceID)
	}
	return nil
}

// Exec executes a command in a workspace runtime
func (m *RuntimeManager) Exec(ctx context.Context, workspace *models.Workspace, cmd []string) (string, error) {
	if workspace.Runtime == nil {
		return "", fmt.Errorf("workspace has no runtime configuration")
	}

	switch workspace.Runtime.Type {
	case models.RuntimeTypeLocal:
		return m.execLocal(ctx, cmd)

	case models.RuntimeTypeDockerLocal:
		// First try to get container from runtime cache
		m.mu.RLock()
		info, exists := m.containers[workspace.ID]
		m.mu.RUnlock()

		var containerID string
		if exists {
			containerID = info.ContainerID
		} else {
			// Fallback to workspace runtime config (e.g., after program restart)
			containerID = m.getContainerIDFromRuntime(workspace.Runtime)
			if containerID == "" {
				return "", fmt.Errorf("container not configured")
			}
		}

		return m.execInContainer(ctx, nil, containerID, cmd)

	case models.RuntimeTypeDockerRemote:
		// First try to get container from runtime cache
		m.mu.RLock()
		info, exists := m.containers[workspace.ID]
		m.mu.RUnlock()

		var containerID string
		if exists {
			containerID = info.ContainerID
		} else {
			// Fallback to workspace runtime config (e.g., after program restart)
			containerID = m.getContainerIDFromRuntime(workspace.Runtime)
			if containerID == "" {
				return "", fmt.Errorf("container not configured")
			}
		}

		var dockerAsset *models.Asset
		if workspace.Runtime.DockerAssetID != nil {
			var err error
			dockerAsset, err = m.assetService.GetAsset(*workspace.Runtime.DockerAssetID)
			if err != nil {
				return "", fmt.Errorf("failed to get docker host asset: %w", err)
			}
		}

		return m.execInContainer(ctx, dockerAsset, containerID, cmd)

	default:
		return "", fmt.Errorf("unsupported runtime type: %s", workspace.Runtime.Type)
	}
}

// getContainerIDFromRuntime extracts container ID or name from runtime config
func (m *RuntimeManager) getContainerIDFromRuntime(runtime *models.WorkspaceRuntime) string {
	if runtime.ContainerName != nil && *runtime.ContainerName != "" {
		return *runtime.ContainerName
	}
	if runtime.ContainerID != nil && *runtime.ContainerID != "" {
		return *runtime.ContainerID
	}
	return ""
}

// execLocal executes a command locally
func (m *RuntimeManager) execLocal(ctx context.Context, cmd []string) (string, error) {
	if len(cmd) == 0 {
		return "", fmt.Errorf("empty command")
	}

	c := exec.CommandContext(ctx, cmd[0], cmd[1:]...)
	var stdout, stderr bytes.Buffer
	c.Stdout = &stdout
	c.Stderr = &stderr

	if err := c.Run(); err != nil {
		errMsg := strings.TrimSpace(stderr.String())
		if errMsg == "" {
			errMsg = err.Error()
		}
		return "", fmt.Errorf("%s", errMsg)
	}

	return stdout.String(), nil
}

// execInContainer executes a command in a container
func (m *RuntimeManager) execInContainer(ctx context.Context, dockerAsset *models.Asset, containerID string, cmd []string) (string, error) {
	// Join command parts and execute via shell to handle complex commands
	cmdStr := strings.Join(cmd, " ")
	args := []string{"exec", containerID, "/bin/sh", "-c", cmdStr}
	return m.execDocker(ctx, dockerAsset, args...)
}

// execDocker executes a docker command either locally or via SSH
func (m *RuntimeManager) execDocker(ctx context.Context, dockerAsset *models.Asset, args ...string) (string, error) {
	if dockerAsset == nil {
		// Local docker
		return m.execLocalDocker(ctx, args...)
	}

	var cfg models.DockerHostConfig
	if err := dockerAsset.GetTypedConfig(&cfg); err != nil {
		return "", fmt.Errorf("invalid docker host config: %w", err)
	}

	if cfg.ConnectionType == "ssh" && cfg.SSHAssetID != "" {
		return m.dockerService.execViaSSH(ctx, cfg.SSHAssetID, "docker", args)
	}

	return m.execLocalDocker(ctx, args...)
}

// execLocalDocker executes a docker command locally
func (m *RuntimeManager) execLocalDocker(ctx context.Context, args ...string) (string, error) {
	ctx, cancel := context.WithTimeout(ctx, 5*time.Minute)
	defer cancel()

	cmd := exec.CommandContext(ctx, "docker", args...)
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr

	if err := cmd.Run(); err != nil {
		errMsg := strings.TrimSpace(stderr.String())
		if errMsg == "" {
			errMsg = err.Error()
		}
		return "", fmt.Errorf("%s", errMsg)
	}

	return stdout.String(), nil
}

// getStringPtr safely gets string value from pointer
func getStringPtr(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}

// min returns the minimum of two integers
func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}

// expandPath expands ~ to the user's home directory
func expandPath(path string) string {
	if path == "" {
		return path
	}

	if strings.HasPrefix(path, "~/") {
		home, err := os.UserHomeDir()
		if err != nil {
			return path
		}
		return filepath.Join(home, path[2:])
	}

	if path == "~" {
		home, err := os.UserHomeDir()
		if err != nil {
			return path
		}
		return home
	}

	return path
}
