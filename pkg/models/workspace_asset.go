package models

import (
	"time"
)

// WorkspaceAssetRef represents a reference to an asset within a workspace
type WorkspaceAssetRef struct {
	ID           string    `json:"id" gorm:"primaryKey;size:36"`
	WorkspaceID  string    `json:"workspace_id" gorm:"index;size:36;not null"`
	AssetID      string    `json:"asset_id" gorm:"size:36;not null"`
	AssetType    string    `json:"asset_type" gorm:"size:20;not null"`
	AssetName    string    `json:"asset_name" gorm:"size:100"`
	AIHint       *string   `json:"ai_hint,omitempty" gorm:"type:text"`
	Restrictions JSONMap   `json:"restrictions,omitempty" gorm:"type:json"`
	CreatedAt    time.Time `json:"created_at"`
}

// TableName returns the table name for WorkspaceAssetRef
func (WorkspaceAssetRef) TableName() string {
	return "workspace_asset_refs"
}

// TerminalRestrictions represents common restrictions for terminal-based assets
type TerminalRestrictions struct {
	AllowedCommands []string `json:"allowed_commands,omitempty"`
	BlockedCommands []string `json:"blocked_commands,omitempty"`
	AllowedPaths    []string `json:"allowed_paths,omitempty"`
	BlockedPaths    []string `json:"blocked_paths,omitempty"`
	AllowedEnvVars  []string `json:"allowed_env_vars,omitempty"`
	BlockedEnvVars  []string `json:"blocked_env_vars,omitempty"`
}

// SSHRestrictions represents SSH-specific restrictions
type SSHRestrictions struct {
	TerminalRestrictions
	AllowPortForwarding *bool `json:"allow_port_forwarding,omitempty"`
	AllowedForwardPorts []int `json:"allowed_forward_ports,omitempty"`
	MaxSessionDuration  *int  `json:"max_session_duration,omitempty"`
	AllowSudo           *bool `json:"allow_sudo,omitempty"`
	AllowScp            *bool `json:"allow_scp,omitempty"`
	AllowSftp           *bool `json:"allow_sftp,omitempty"`
}

// LocalRestrictions represents local terminal restrictions
type LocalRestrictions struct {
	TerminalRestrictions
	AllowSudo          *bool `json:"allow_sudo,omitempty"`
	AllowNetworkAccess *bool `json:"allow_network_access,omitempty"`
}

// DockerRestrictions represents Docker host restrictions
type DockerRestrictions struct {
	TerminalRestrictions
	AllowedContainers    []string `json:"allowed_containers,omitempty"`
	BlockedContainers    []string `json:"blocked_containers,omitempty"`
	AllowContainerCreate *bool    `json:"allow_container_create,omitempty"`
	AllowContainerDelete *bool    `json:"allow_container_delete,omitempty"`
	AllowContainerExec   *bool    `json:"allow_container_exec,omitempty"`
	AllowImagePull       *bool    `json:"allow_image_pull,omitempty"`
	AllowImageDelete     *bool    `json:"allow_image_delete,omitempty"`
	AllowVolumeAccess    *bool    `json:"allow_volume_access,omitempty"`
	AllowNetworkAccess   *bool    `json:"allow_network_access,omitempty"`
	AllowPrivileged      *bool    `json:"allow_privileged,omitempty"`
}

// DatabaseRestrictions represents database restrictions
type DatabaseRestrictions struct {
	ReadOnly              *bool    `json:"read_only,omitempty"`
	AllowedDatabases      []string `json:"allowed_databases,omitempty"`
	BlockedDatabases      []string `json:"blocked_databases,omitempty"`
	AllowedTables         []string `json:"allowed_tables,omitempty"`
	BlockedTables         []string `json:"blocked_tables,omitempty"`
	AllowedOperations     []string `json:"allowed_operations,omitempty"`
	BlockedOperations     []string `json:"blocked_operations,omitempty"`
	MaxRowsReturn         *int     `json:"max_rows_return,omitempty"`
	AllowDDL              *bool    `json:"allow_ddl,omitempty"`
	AllowStoredProcedures *bool    `json:"allow_stored_procedures,omitempty"`
}

// K8sRestrictions represents Kubernetes restrictions
type K8sRestrictions struct {
	AllowedNamespaces []string `json:"allowed_namespaces,omitempty"`
	BlockedNamespaces []string `json:"blocked_namespaces,omitempty"`
	AllowedResources  []string `json:"allowed_resources,omitempty"`
	BlockedResources  []string `json:"blocked_resources,omitempty"`
	AllowedVerbs      []string `json:"allowed_verbs,omitempty"`
	BlockedVerbs      []string `json:"blocked_verbs,omitempty"`
	AllowExec         *bool    `json:"allow_exec,omitempty"`
	AllowPortForward  *bool    `json:"allow_port_forward,omitempty"`
	AllowLogs         *bool    `json:"allow_logs,omitempty"`
	ReadOnly          *bool    `json:"read_only,omitempty"`
}

// RedisRestrictions represents Redis restrictions
type RedisRestrictions struct {
	AllowedCommands    []string `json:"allowed_commands,omitempty"`
	BlockedCommands    []string `json:"blocked_commands,omitempty"`
	AllowedKeyPatterns []string `json:"allowed_key_patterns,omitempty"`
	BlockedKeyPatterns []string `json:"blocked_key_patterns,omitempty"`
	ReadOnly           *bool    `json:"read_only,omitempty"`
	MaxKeysReturn      *int     `json:"max_keys_return,omitempty"`
}
