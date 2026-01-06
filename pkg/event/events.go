package event

// ============================================================================
// Event Names (constants)
// ============================================================================

const (
	FSChanged           = "fs.changed"
	FSCreated           = "fs.created"
	FSDeleted           = "fs.deleted"
	FSRenamed           = "fs.renamed"
	AssetCreated        = "asset.created"
	AssetUpdated        = "asset.updated"
	AssetDeleted        = "asset.deleted"
	TunnelCreated       = "tunnel.created"
	TunnelStatusChanged = "tunnel.statusChanged"
	TunnelDeleted       = "tunnel.deleted"
	ContainerStatus     = "container.statusChanged"
	ContainerList       = "container.listChanged"
	TaskCreated         = "task.created"
	TaskProgress        = "task.progress"
	TaskCompleted       = "task.completed"
	AgentHeartbeat      = "agent.heartbeat"
	AgentMetrics        = "agent.metrics"
	AgentDisconnected   = "agent.disconnected"
	ConfigChanged       = "system.configChanged"
)

// ============================================================================
// Filesystem Events
// ============================================================================

// FSChangedEvent is emitted when files/directories change.
type FSChangedEvent struct {
	AssetID string   // Which asset's filesystem
	Paths   []string // Affected paths (optional, empty means "check everything")
}

func (e FSChangedEvent) EventName() string { return FSChanged }

// FSCreatedEvent is emitted when a file/directory is created.
type FSCreatedEvent struct {
	AssetID string
	Path    string
	IsDir   bool
}

func (e FSCreatedEvent) EventName() string { return FSCreated }

// FSDeletedEvent is emitted when a file/directory is deleted.
type FSDeletedEvent struct {
	AssetID string
	Path    string
}

func (e FSDeletedEvent) EventName() string { return FSDeleted }

// FSRenamedEvent is emitted when a file/directory is renamed/moved.
type FSRenamedEvent struct {
	AssetID string
	OldPath string
	NewPath string
}

func (e FSRenamedEvent) EventName() string { return FSRenamed }

// ============================================================================
// Asset Events
// ============================================================================

// AssetCreatedEvent is emitted when an asset is created.
type AssetCreatedEvent struct {
	AssetID string
}

func (e AssetCreatedEvent) EventName() string { return AssetCreated }

// AssetUpdatedEvent is emitted when an asset is updated.
type AssetUpdatedEvent struct {
	AssetID string
}

func (e AssetUpdatedEvent) EventName() string { return AssetUpdated }

// AssetDeletedEvent is emitted when an asset is deleted.
type AssetDeletedEvent struct {
	AssetID string
}

func (e AssetDeletedEvent) EventName() string { return AssetDeleted }

// ============================================================================
// Tunnel Events
// ============================================================================

// TunnelCreatedEvent is emitted when a tunnel is created.
type TunnelCreatedEvent struct {
	TunnelID string
	AssetID  string
}

func (e TunnelCreatedEvent) EventName() string { return TunnelCreated }

// TunnelStatusChangedEvent is emitted when tunnel status changes.
type TunnelStatusChangedEvent struct {
	TunnelID string
	Status   string // "running", "stopped", "error"
}

func (e TunnelStatusChangedEvent) EventName() string { return TunnelStatusChanged }

// TunnelDeletedEvent is emitted when a tunnel is deleted.
type TunnelDeletedEvent struct {
	TunnelID string
}

func (e TunnelDeletedEvent) EventName() string { return TunnelDeleted }

// ============================================================================
// Docker/Container Events
// ============================================================================

// ContainerStatusChangedEvent is emitted when container status changes.
type ContainerStatusChangedEvent struct {
	AssetID     string
	ContainerID string
	Status      string // "running", "stopped", "exited", etc.
}

func (e ContainerStatusChangedEvent) EventName() string { return ContainerStatus }

// ContainerListChangedEvent is emitted when the container list changes.
type ContainerListChangedEvent struct {
	AssetID string
}

func (e ContainerListChangedEvent) EventName() string { return ContainerList }

// ============================================================================
// Task Events
// ============================================================================

// TaskCreatedEvent is emitted when a task is created.
type TaskCreatedEvent struct {
	TaskID   string
	TaskType string // "file_transfer", "code_scan", etc.
}

func (e TaskCreatedEvent) EventName() string { return TaskCreated }

// TaskProgressEvent is emitted when task progress updates.
type TaskProgressEvent struct {
	TaskID string
	Total  int64  // Total amount (bytes, items, etc.)
	Done   int64  // Completed amount
	Unit   string // "bytes", "files", etc.
	Note   string // Optional status note
}

func (e TaskProgressEvent) EventName() string { return TaskProgress }

// TaskCompletedEvent is emitted when a task completes.
type TaskCompletedEvent struct {
	TaskID  string
	Success bool
}

func (e TaskCompletedEvent) EventName() string { return TaskCompleted }

// ============================================================================
// Agent Events (external agent reports)
// ============================================================================

// AgentHeartbeatEvent is emitted when an agent sends heartbeat.
type AgentHeartbeatEvent struct {
	AgentID string
}

func (e AgentHeartbeatEvent) EventName() string { return AgentHeartbeat }

// AgentMetricsEvent is emitted when agent reports metrics.
type AgentMetricsEvent struct {
	AgentID string
}

func (e AgentMetricsEvent) EventName() string { return AgentMetrics }

// AgentDisconnectedEvent is emitted when an agent disconnects.
type AgentDisconnectedEvent struct {
	AgentID string
}

func (e AgentDisconnectedEvent) EventName() string { return AgentDisconnected }

// ============================================================================
// System Events
// ============================================================================

// ConfigChangedEvent is emitted when configuration changes.
type ConfigChangedEvent struct{}

func (e ConfigChangedEvent) EventName() string { return ConfigChanged }
