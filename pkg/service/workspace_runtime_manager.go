package service

import (
	"context"
	"fmt"
	"sync"

	"github.com/choraleia/choraleia/pkg/models"
	"github.com/choraleia/choraleia/pkg/service/fs"
)

// RuntimeManager manages workspace runtime environments
type RuntimeManager struct {
	dockerService *DockerService
	sshPool       *fs.SSHPool
	containers    map[string]*ContainerInfo
	mu            sync.RWMutex
}

// ContainerInfo stores information about a running container
type ContainerInfo struct {
	ContainerID string
	WorkspaceID string
	Status      string
	StartedAt   int64
}

// NewRuntimeManager creates a new RuntimeManager
func NewRuntimeManager() *RuntimeManager {
	return &RuntimeManager{
		containers: make(map[string]*ContainerInfo),
	}
}

// SetDockerService sets the docker service
func (m *RuntimeManager) SetDockerService(ds *DockerService) {
	m.dockerService = ds
}

// SetSSHPool sets the SSH pool
func (m *RuntimeManager) SetSSHPool(pool *fs.SSHPool) {
	m.sshPool = pool
}

// StartRuntime starts the runtime for a workspace
func (m *RuntimeManager) StartRuntime(ctx context.Context, workspace *models.Workspace) error {
	if workspace.Runtime == nil {
		return nil
	}

	switch workspace.Runtime.Type {
	case models.RuntimeTypeLocal:
		// Local runtime doesn't need to start anything
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
	var err error

	if runtime.ContainerMode != nil && *runtime.ContainerMode == models.ContainerModeNew {
		// Create new container
		if runtime.NewContainerImage == nil || *runtime.NewContainerImage == "" {
			return fmt.Errorf("container image is required for new container")
		}
		containerID, err = m.createAndStartContainer(ctx, workspace)
	} else {
		// Use existing container
		if runtime.ContainerID == nil || *runtime.ContainerID == "" {
			return fmt.Errorf("container ID is required for existing container")
		}
		containerID = *runtime.ContainerID
		err = m.startExistingContainer(ctx, containerID)
	}

	if err != nil {
		return err
	}

	// Store container info
	m.mu.Lock()
	m.containers[workspace.ID] = &ContainerInfo{
		ContainerID: containerID,
		WorkspaceID: workspace.ID,
		Status:      "running",
		StartedAt:   getCurrentTimestamp(),
	}
	m.mu.Unlock()

	return nil
}

// startDockerRemoteRuntime starts a Docker container on a remote host
func (m *RuntimeManager) startDockerRemoteRuntime(ctx context.Context, workspace *models.Workspace) error {
	// TODO: Implement remote Docker runtime via SSH
	return fmt.Errorf("remote docker runtime not yet implemented")
}

// createAndStartContainer creates and starts a new container
func (m *RuntimeManager) createAndStartContainer(ctx context.Context, workspace *models.Workspace) (string, error) {
	// TODO: Implement actual container creation using Docker service
	// For now, return a placeholder
	return fmt.Sprintf("container-%s", workspace.ID[:8]), nil
}

// startExistingContainer starts an existing container
func (m *RuntimeManager) startExistingContainer(ctx context.Context, containerID string) error {
	// TODO: Implement actual container start using Docker service
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

	switch workspace.Runtime.Type {
	case models.RuntimeTypeLocal:
		return nil

	case models.RuntimeTypeDockerLocal, models.RuntimeTypeDockerRemote:
		// Only stop if we created the container
		if workspace.Runtime.ContainerMode != nil && *workspace.Runtime.ContainerMode == models.ContainerModeNew {
			return m.stopContainer(ctx, info.ContainerID)
		}
		return nil

	default:
		return nil
	}
}

// stopContainer stops a container
func (m *RuntimeManager) stopContainer(ctx context.Context, containerID string) error {
	// TODO: Implement actual container stop using Docker service
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
		status.Uptime = getCurrentTimestamp() - info.StartedAt
	}

	return status, nil
}

// Exec executes a command in a workspace runtime
func (m *RuntimeManager) Exec(ctx context.Context, workspace *models.Workspace, cmd []string) (string, error) {
	if workspace.Runtime == nil {
		return "", fmt.Errorf("workspace has no runtime configuration")
	}

	switch workspace.Runtime.Type {
	case models.RuntimeTypeLocal:
		// TODO: Execute locally
		return "", fmt.Errorf("local execution not yet implemented")

	case models.RuntimeTypeDockerLocal, models.RuntimeTypeDockerRemote:
		m.mu.RLock()
		info, exists := m.containers[workspace.ID]
		m.mu.RUnlock()

		if !exists {
			return "", fmt.Errorf("container not running")
		}

		// TODO: Execute in container using Docker exec
		return fmt.Sprintf("executed in container %s", info.ContainerID), nil

	default:
		return "", fmt.Errorf("unsupported runtime type: %s", workspace.Runtime.Type)
	}
}

// getCurrentTimestamp returns the current Unix timestamp
func getCurrentTimestamp() int64 {
	return 0 // TODO: return time.Now().Unix()
}
