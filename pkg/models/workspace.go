package models

import (
	"database/sql/driver"
	"encoding/json"
	"errors"
	"time"
)

// JSONMap is a type for storing JSON data in database
type JSONMap map[string]interface{}

// Value implements driver.Valuer for JSONMap
func (j JSONMap) Value() (driver.Value, error) {
	if j == nil {
		return nil, nil
	}
	return json.Marshal(j)
}

// Scan implements sql.Scanner for JSONMap
func (j *JSONMap) Scan(value interface{}) error {
	if value == nil {
		*j = nil
		return nil
	}
	bytes, ok := value.([]byte)
	if !ok {
		return errors.New("type assertion to []byte failed")
	}
	return json.Unmarshal(bytes, j)
}

// WorkspaceStatus represents the status of a workspace
type WorkspaceStatus string

const (
	WorkspaceStatusRunning  WorkspaceStatus = "running"
	WorkspaceStatusStopped  WorkspaceStatus = "stopped"
	WorkspaceStatusStarting WorkspaceStatus = "starting"
	WorkspaceStatusStopping WorkspaceStatus = "stopping"
	WorkspaceStatusError    WorkspaceStatus = "error"
)

// RuntimeType represents the type of runtime environment
type RuntimeType string

const (
	RuntimeTypeLocal        RuntimeType = "local"
	RuntimeTypeDockerLocal  RuntimeType = "docker-local"
	RuntimeTypeDockerRemote RuntimeType = "docker-remote"
)

// ContainerMode represents the container selection mode
type ContainerMode string

const (
	ContainerModeExisting ContainerMode = "existing"
	ContainerModeNew      ContainerMode = "new"
)

// Workspace represents a workspace configuration
type Workspace struct {
	ID           string          `json:"id" gorm:"primaryKey;size:36"`
	Name         string          `json:"name" gorm:"uniqueIndex;size:63;not null"`
	Description  string          `json:"description" gorm:"size:500"`
	Status       WorkspaceStatus `json:"status" gorm:"size:20;default:'stopped'"`
	Color        string          `json:"color" gorm:"size:20"`
	ActiveRoomID string          `json:"active_room_id" gorm:"size:36"`
	CreatedAt    time.Time       `json:"created_at"`
	UpdatedAt    time.Time       `json:"updated_at"`

	// Relations
	Runtime *WorkspaceRuntime   `json:"runtime,omitempty" gorm:"foreignKey:WorkspaceID;constraint:OnDelete:CASCADE"`
	Assets  []WorkspaceAssetRef `json:"assets,omitempty" gorm:"foreignKey:WorkspaceID;constraint:OnDelete:CASCADE"`
	Tools   []WorkspaceTool     `json:"tools,omitempty" gorm:"foreignKey:WorkspaceID;constraint:OnDelete:CASCADE"`
	Rooms   []Room              `json:"rooms,omitempty" gorm:"foreignKey:WorkspaceID;constraint:OnDelete:CASCADE"`
}

// TableName returns the table name for Workspace
func (Workspace) TableName() string {
	return "workspaces"
}

// WorkspaceRuntime represents the runtime configuration for a workspace
type WorkspaceRuntime struct {
	ID          string      `json:"id" gorm:"primaryKey;size:36"`
	WorkspaceID string      `json:"workspace_id" gorm:"uniqueIndex;size:36;not null"`
	Type        RuntimeType `json:"type" gorm:"size:20;not null"`

	// Docker related
	DockerAssetID *string        `json:"docker_asset_id,omitempty" gorm:"size:36"`
	ContainerMode *ContainerMode `json:"container_mode,omitempty" gorm:"size:20"`
	ContainerID   *string        `json:"container_id,omitempty" gorm:"size:100"`
	ContainerName *string        `json:"container_name,omitempty" gorm:"size:100"` // Actual container name used at runtime

	// New container configuration
	NewContainerImage *string `json:"new_container_image,omitempty" gorm:"size:200"`
	NewContainerName  *string `json:"new_container_name,omitempty" gorm:"size:100"`

	// Work directory
	WorkDirPath          string  `json:"work_dir_path" gorm:"size:500"`
	WorkDirContainerPath *string `json:"work_dir_container_path,omitempty" gorm:"size:500"`
}

// TableName returns the table name for WorkspaceRuntime
func (WorkspaceRuntime) TableName() string {
	return "workspace_runtimes"
}

// Room represents a room/sub-workspace within a workspace
type Room struct {
	ID           string    `json:"id" gorm:"primaryKey;size:36"`
	WorkspaceID  string    `json:"workspace_id" gorm:"index;size:36;not null"`
	Name         string    `json:"name" gorm:"size:100;not null"`
	Description  *string   `json:"description,omitempty" gorm:"size:500"`
	Layout       JSONMap   `json:"layout,omitempty" gorm:"type:json"`
	ActivePaneID *string   `json:"active_pane_id,omitempty" gorm:"size:36"`
	CreatedAt    time.Time `json:"created_at"`
	UpdatedAt    time.Time `json:"updated_at"`
}

// TableName returns the table name for Room
func (Room) TableName() string {
	return "workspace_rooms"
}

// WorkspaceListItem represents a workspace in list view (without relations)
type WorkspaceListItem struct {
	ID          string          `json:"id"`
	Name        string          `json:"name"`
	Description string          `json:"description"`
	Status      WorkspaceStatus `json:"status"`
	Color       string          `json:"color"`
	RuntimeType RuntimeType     `json:"runtime_type"`
	RoomsCount  int             `json:"rooms_count"`
	CreatedAt   time.Time       `json:"created_at"`
	UpdatedAt   time.Time       `json:"updated_at"`
}
