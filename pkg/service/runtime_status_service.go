package service

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"sync"
	"time"

	"github.com/choraleia/choraleia/pkg/models"
	"github.com/choraleia/choraleia/pkg/utils"
)

// RuntimePhase represents different phases of runtime lifecycle
type RuntimePhase string

const (
	RuntimePhaseIdle     RuntimePhase = "idle"
	RuntimePhasePulling  RuntimePhase = "pulling"  // Pulling image
	RuntimePhaseCreating RuntimePhase = "creating" // Creating container
	RuntimePhaseStarting RuntimePhase = "starting" // Starting container
	RuntimePhaseRunning  RuntimePhase = "running"  // Container running
	RuntimePhaseStopping RuntimePhase = "stopping" // Stopping container
	RuntimePhaseStopped  RuntimePhase = "stopped"  // Container stopped
	RuntimePhaseRemoving RuntimePhase = "removing" // Removing container
	RuntimePhaseError    RuntimePhase = "error"    // Error state
)

// RuntimeDetailedStatus contains comprehensive runtime status information
type RuntimeDetailedStatus struct {
	WorkspaceID string       `json:"workspace_id"`
	Phase       RuntimePhase `json:"phase"`
	Message     string       `json:"message,omitempty"`
	Progress    int          `json:"progress,omitempty"` // 0-100 for operations with progress
	Error       string       `json:"error,omitempty"`

	// Container info (when applicable)
	ContainerID     string `json:"container_id,omitempty"`
	ContainerName   string `json:"container_name,omitempty"`
	ContainerStatus string `json:"container_status,omitempty"`
	ContainerImage  string `json:"container_image,omitempty"`

	// Timestamps
	StartedAt     *time.Time `json:"started_at,omitempty"`
	LastUpdatedAt time.Time  `json:"last_updated_at"`

	// Resource usage (when running)
	Resources *RuntimeResources `json:"resources,omitempty"`

	// System info (when running)
	SystemInfo *RuntimeSystemInfo `json:"system_info,omitempty"`
}

// RuntimeResources contains resource usage information
type RuntimeResources struct {
	CPUPercent    float64 `json:"cpu_percent"`
	MemoryUsage   int64   `json:"memory_usage"` // bytes
	MemoryLimit   int64   `json:"memory_limit"` // bytes
	MemoryPercent float64 `json:"memory_percent"`
	NetworkRx     int64   `json:"network_rx"` // bytes
	NetworkTx     int64   `json:"network_tx"` // bytes
	DiskRead      int64   `json:"disk_read"`  // bytes
	DiskWrite     int64   `json:"disk_write"` // bytes
}

// RuntimeSystemInfo contains system information
type RuntimeSystemInfo struct {
	OS            string    `json:"os,omitempty"`
	Architecture  string    `json:"architecture,omitempty"`
	DockerVersion string    `json:"docker_version,omitempty"`
	Hostname      string    `json:"hostname,omitempty"`
	Uptime        int64     `json:"uptime,omitempty"`       // seconds
	LoadAverage   []float64 `json:"load_average,omitempty"` // 1, 5, 15 min
}

// RuntimeOperation represents an async operation on a runtime
type RuntimeOperation struct {
	ID          string       `json:"id"`
	WorkspaceID string       `json:"workspace_id"`
	Type        string       `json:"type"` // start, stop, restart, pull
	Phase       RuntimePhase `json:"phase"`
	Progress    int          `json:"progress"`
	Message     string       `json:"message,omitempty"`
	Error       string       `json:"error,omitempty"`
	StartedAt   time.Time    `json:"started_at"`
	EndedAt     *time.Time   `json:"ended_at,omitempty"`
	cancel      context.CancelFunc
}

// RuntimeStatusCallback is called when runtime status changes
type RuntimeStatusCallback func(status *RuntimeDetailedStatus)

// RuntimeStatusService manages and monitors runtime statuses
type RuntimeStatusService struct {
	statuses       map[string]*RuntimeDetailedStatus // workspaceID -> status
	operations     map[string]*RuntimeOperation      // operationID -> operation
	callbacks      []RuntimeStatusCallback
	mu             sync.RWMutex
	logger         *slog.Logger
	dockerService  *DockerService
	assetService   *AssetService
	monitorTicker  *time.Ticker
	stopMonitor    chan struct{}
	monitorStarted bool
}

// NewRuntimeStatusService creates a new RuntimeStatusService
func NewRuntimeStatusService(dockerService *DockerService, assetService *AssetService) *RuntimeStatusService {
	return &RuntimeStatusService{
		statuses:      make(map[string]*RuntimeDetailedStatus),
		operations:    make(map[string]*RuntimeOperation),
		callbacks:     make([]RuntimeStatusCallback, 0),
		logger:        utils.GetLogger(),
		dockerService: dockerService,
		assetService:  assetService,
		stopMonitor:   make(chan struct{}),
	}
}

// RegisterCallback registers a callback for status changes
func (s *RuntimeStatusService) RegisterCallback(cb RuntimeStatusCallback) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.callbacks = append(s.callbacks, cb)
}

// notifyCallbacks notifies all registered callbacks
func (s *RuntimeStatusService) notifyCallbacks(status *RuntimeDetailedStatus) {
	s.mu.RLock()
	callbacks := make([]RuntimeStatusCallback, len(s.callbacks))
	copy(callbacks, s.callbacks)
	s.mu.RUnlock()

	for _, cb := range callbacks {
		go cb(status)
	}
}

// GetStatus returns the current status for a workspace
func (s *RuntimeStatusService) GetStatus(workspaceID string) *RuntimeDetailedStatus {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if status, exists := s.statuses[workspaceID]; exists {
		return status
	}
	return &RuntimeDetailedStatus{
		WorkspaceID:   workspaceID,
		Phase:         RuntimePhaseIdle,
		LastUpdatedAt: time.Now(),
	}
}

// GetAllStatuses returns all current statuses
func (s *RuntimeStatusService) GetAllStatuses() map[string]*RuntimeDetailedStatus {
	s.mu.RLock()
	defer s.mu.RUnlock()
	result := make(map[string]*RuntimeDetailedStatus)
	for k, v := range s.statuses {
		result[k] = v
	}
	return result
}

// UpdateStatus updates the status for a workspace
func (s *RuntimeStatusService) UpdateStatus(workspaceID string, phase RuntimePhase, message string) {
	s.mu.Lock()
	status, exists := s.statuses[workspaceID]
	if !exists {
		status = &RuntimeDetailedStatus{
			WorkspaceID: workspaceID,
		}
		s.statuses[workspaceID] = status
	}
	status.Phase = phase
	status.Message = message
	status.LastUpdatedAt = time.Now()
	s.mu.Unlock()

	s.notifyCallbacks(status)
}

// SetContainerInfo sets container information
func (s *RuntimeStatusService) SetContainerInfo(workspaceID, containerID, containerName, containerImage string) {
	s.mu.Lock()
	status, exists := s.statuses[workspaceID]
	if !exists {
		status = &RuntimeDetailedStatus{
			WorkspaceID: workspaceID,
		}
		s.statuses[workspaceID] = status
	}
	status.ContainerID = containerID
	status.ContainerName = containerName
	status.ContainerImage = containerImage
	status.LastUpdatedAt = time.Now()
	s.mu.Unlock()

	s.notifyCallbacks(status)
}

// SetError sets an error state
func (s *RuntimeStatusService) SetError(workspaceID string, err error) {
	s.mu.Lock()
	status, exists := s.statuses[workspaceID]
	if !exists {
		status = &RuntimeDetailedStatus{
			WorkspaceID: workspaceID,
		}
		s.statuses[workspaceID] = status
	}
	status.Phase = RuntimePhaseError
	status.Error = err.Error()
	status.LastUpdatedAt = time.Now()
	s.mu.Unlock()

	s.notifyCallbacks(status)
}

// SetProgress sets progress for an operation (0-100)
func (s *RuntimeStatusService) SetProgress(workspaceID string, progress int, message string) {
	s.mu.Lock()
	status, exists := s.statuses[workspaceID]
	if !exists {
		status = &RuntimeDetailedStatus{
			WorkspaceID: workspaceID,
		}
		s.statuses[workspaceID] = status
	}
	status.Progress = progress
	status.Message = message
	status.LastUpdatedAt = time.Now()
	s.mu.Unlock()

	s.notifyCallbacks(status)
}

// SetRunning marks the runtime as running
func (s *RuntimeStatusService) SetRunning(workspaceID string, containerID string) {
	now := time.Now()
	s.mu.Lock()
	status, exists := s.statuses[workspaceID]
	if !exists {
		status = &RuntimeDetailedStatus{
			WorkspaceID: workspaceID,
		}
		s.statuses[workspaceID] = status
	}
	status.Phase = RuntimePhaseRunning
	status.ContainerID = containerID
	status.StartedAt = &now
	status.Error = ""
	status.Message = ""
	status.Progress = 100
	status.LastUpdatedAt = now
	s.mu.Unlock()

	s.notifyCallbacks(status)
}

// SetStopped marks the runtime as stopped
func (s *RuntimeStatusService) SetStopped(workspaceID string) {
	s.mu.Lock()
	status, exists := s.statuses[workspaceID]
	if !exists {
		status = &RuntimeDetailedStatus{
			WorkspaceID: workspaceID,
		}
		s.statuses[workspaceID] = status
	}
	status.Phase = RuntimePhaseStopped
	status.Resources = nil
	status.Error = ""
	status.Message = ""
	status.LastUpdatedAt = time.Now()
	s.mu.Unlock()

	s.notifyCallbacks(status)
}

// RemoveStatus removes the status for a workspace
func (s *RuntimeStatusService) RemoveStatus(workspaceID string) {
	s.mu.Lock()
	delete(s.statuses, workspaceID)
	s.mu.Unlock()
}

// StartMonitoring starts the background monitoring goroutine
func (s *RuntimeStatusService) StartMonitoring(interval time.Duration) {
	s.mu.Lock()
	if s.monitorStarted {
		s.mu.Unlock()
		return
	}
	s.monitorStarted = true
	s.monitorTicker = time.NewTicker(interval)
	s.mu.Unlock()

	go s.monitorLoop()
}

// StopMonitoring stops the background monitoring
func (s *RuntimeStatusService) StopMonitoring() {
	s.mu.Lock()
	if !s.monitorStarted {
		s.mu.Unlock()
		return
	}
	s.monitorStarted = false
	if s.monitorTicker != nil {
		s.monitorTicker.Stop()
	}
	s.mu.Unlock()

	close(s.stopMonitor)
}

// monitorLoop is the main monitoring loop
func (s *RuntimeStatusService) monitorLoop() {
	for {
		select {
		case <-s.stopMonitor:
			return
		case <-s.monitorTicker.C:
			s.refreshAllStatuses()
		}
	}
}

// refreshAllStatuses refreshes status for all running workspaces
func (s *RuntimeStatusService) refreshAllStatuses() {
	s.mu.RLock()
	workspaceIDs := make([]string, 0)
	for wid, status := range s.statuses {
		if status.Phase == RuntimePhaseRunning && status.ContainerID != "" {
			workspaceIDs = append(workspaceIDs, wid)
		}
	}
	s.mu.RUnlock()

	for _, wid := range workspaceIDs {
		s.refreshStatus(wid)
	}
}

// refreshStatus refreshes the status for a single workspace
func (s *RuntimeStatusService) refreshStatus(workspaceID string) {
	s.mu.RLock()
	status, exists := s.statuses[workspaceID]
	if !exists || status.ContainerID == "" {
		s.mu.RUnlock()
		return
	}
	containerID := status.ContainerID
	s.mu.RUnlock()

	// Get container stats
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	resources, err := s.getContainerStats(ctx, containerID)
	if err != nil {
		s.logger.Debug("Failed to get container stats", "containerID", containerID, "error", err)
		return
	}

	s.mu.Lock()
	if st, ok := s.statuses[workspaceID]; ok {
		st.Resources = resources
		st.LastUpdatedAt = time.Now()
	}
	s.mu.Unlock()
}

// getContainerStats gets resource stats for a container
func (s *RuntimeStatusService) getContainerStats(ctx context.Context, containerID string) (*RuntimeResources, error) {
	if s.dockerService == nil {
		return nil, nil
	}

	// Use docker stats with --no-stream for a single snapshot
	output, err := s.execDockerCommand(ctx, nil, "stats", "--no-stream", "--format", "{{json .}}", containerID)
	if err != nil {
		return nil, err
	}

	var stats struct {
		CPUPerc  string `json:"CPUPerc"`
		MemUsage string `json:"MemUsage"`
		MemPerc  string `json:"MemPerc"`
		NetIO    string `json:"NetIO"`
		BlockIO  string `json:"BlockIO"`
	}

	if err := json.Unmarshal([]byte(output), &stats); err != nil {
		return nil, err
	}

	resources := &RuntimeResources{}
	// Parse CPU percentage (e.g., "0.50%")
	var cpu float64
	if _, err := parseCPUPerc(stats.CPUPerc, &cpu); err == nil {
		resources.CPUPercent = cpu
	}

	// Parse memory percentage
	var mem float64
	if _, err := parseCPUPerc(stats.MemPerc, &mem); err == nil {
		resources.MemoryPercent = mem
	}

	return resources, nil
}

// parseCPUPerc parses a percentage string like "0.50%" into a float
func parseCPUPerc(s string, out *float64) (bool, error) {
	if len(s) < 2 {
		return false, fmt.Errorf("invalid percentage string")
	}
	s = s[:len(s)-1] // Remove % sign
	var val float64
	if err := json.Unmarshal([]byte(s), &val); err != nil {
		return false, err
	}
	*out = val
	return true, nil
}

// execDockerCommand executes a docker command
func (s *RuntimeStatusService) execDockerCommand(ctx context.Context, asset *models.Asset, args ...string) (string, error) {
	if asset == nil {
		// Local docker
		return s.dockerService.execLocal(ctx, "docker", args)
	}

	var cfg models.DockerHostConfig
	if err := asset.GetTypedConfig(&cfg); err != nil {
		return "", err
	}

	if cfg.ConnectionType == "ssh" && cfg.SSHAssetID != "" {
		return s.dockerService.execViaSSH(ctx, cfg.SSHAssetID, "docker", args)
	}

	return s.dockerService.execLocal(ctx, "docker", args)
}

// GetOperation returns an operation by ID
func (s *RuntimeStatusService) GetOperation(operationID string) *RuntimeOperation {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.operations[operationID]
}

// CancelOperation cancels an ongoing operation
func (s *RuntimeStatusService) CancelOperation(operationID string) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	if op, exists := s.operations[operationID]; exists {
		if op.cancel != nil {
			op.cancel()
			return true
		}
	}
	return false
}

// createOperation creates a new operation
func (s *RuntimeStatusService) createOperation(workspaceID, opType string) (*RuntimeOperation, context.Context) {
	ctx, cancel := context.WithCancel(context.Background())
	op := &RuntimeOperation{
		ID:          generateOperationID(),
		WorkspaceID: workspaceID,
		Type:        opType,
		Phase:       RuntimePhaseIdle,
		StartedAt:   time.Now(),
		cancel:      cancel,
	}

	s.mu.Lock()
	s.operations[op.ID] = op
	s.mu.Unlock()

	return op, ctx
}

// completeOperation marks an operation as complete
func (s *RuntimeStatusService) completeOperation(operationID string, err error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if op, exists := s.operations[operationID]; exists {
		now := time.Now()
		op.EndedAt = &now
		if err != nil {
			op.Error = err.Error()
			op.Phase = RuntimePhaseError
		} else {
			op.Phase = RuntimePhaseRunning
			op.Progress = 100
		}
	}
}

// updateOperationProgress updates operation progress
func (s *RuntimeStatusService) updateOperationProgress(operationID string, phase RuntimePhase, progress int, message string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if op, exists := s.operations[operationID]; exists {
		op.Phase = phase
		op.Progress = progress
		op.Message = message
	}
}

// generateOperationID generates a unique operation ID
func generateOperationID() string {
	return time.Now().Format("20060102150405") + "-" + randomString(8)
}

// randomString generates a random string of specified length
func randomString(n int) string {
	const letters = "abcdefghijklmnopqrstuvwxyz0123456789"
	b := make([]byte, n)
	for i := range b {
		b[i] = letters[time.Now().UnixNano()%int64(len(letters))]
	}
	return string(b)
}
