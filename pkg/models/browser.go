package models

import (
	"database/sql/driver"
	"encoding/json"
	"time"
)

// BrowserInstanceStatus represents the status of a browser instance
type BrowserInstanceStatus string

const (
	BrowserInstanceStatusStarting BrowserInstanceStatus = "starting"
	BrowserInstanceStatusReady    BrowserInstanceStatus = "ready"
	BrowserInstanceStatusBusy     BrowserInstanceStatus = "busy"
	BrowserInstanceStatusClosed   BrowserInstanceStatus = "closed"
	BrowserInstanceStatusError    BrowserInstanceStatus = "error"
)

// BrowserRuntimeType indicates where the browser is running
type BrowserRuntimeType string

const (
	BrowserRuntimeLocal     BrowserRuntimeType = "local"
	BrowserRuntimeRemoteSSH BrowserRuntimeType = "remote-ssh"
)

// BrowserTabInfo represents a browser tab (for storage)
type BrowserTabInfo struct {
	ID    string `json:"id"`
	URL   string `json:"url"`
	Title string `json:"title"`
}

// BrowserTabList is a slice of BrowserTabInfo for GORM JSON storage
type BrowserTabList []BrowserTabInfo

// Value implements driver.Valuer
func (t BrowserTabList) Value() (driver.Value, error) {
	if t == nil {
		return "[]", nil
	}
	return json.Marshal(t)
}

// Scan implements sql.Scanner
func (t *BrowserTabList) Scan(value interface{}) error {
	if value == nil {
		*t = []BrowserTabInfo{}
		return nil
	}
	bytes, ok := value.([]byte)
	if !ok {
		*t = []BrowserTabInfo{}
		return nil
	}
	return json.Unmarshal(bytes, t)
}

// BrowserInstanceRecord represents a browser instance record in database
type BrowserInstanceRecord struct {
	ID             string                `json:"id" gorm:"primaryKey;size:36"`
	ConversationID string                `json:"conversation_id" gorm:"index;size:36"`
	WorkspaceID    string                `json:"workspace_id" gorm:"index;size:36"`
	ContainerID    string                `json:"container_id" gorm:"size:64"`
	ContainerName  string                `json:"container_name" gorm:"size:128"`
	ContainerIP    string                `json:"container_ip" gorm:"size:45"`
	RuntimeType    BrowserRuntimeType    `json:"runtime_type" gorm:"size:32"`
	DevToolsURL    string                `json:"devtools_url" gorm:"size:256"`
	DevToolsPort   int                   `json:"devtools_port"`
	CurrentURL     string                `json:"current_url" gorm:"size:2048"`
	CurrentTitle   string                `json:"current_title" gorm:"size:512"`
	Status         BrowserInstanceStatus `json:"status" gorm:"size:32;index"`
	ErrorMessage   string                `json:"error_message" gorm:"size:1024"`
	SSHAssetID     string                `json:"ssh_asset_id" gorm:"size:36"`
	Tabs           BrowserTabList        `json:"tabs" gorm:"type:text"`
	ActiveTab      int                   `json:"active_tab"`
	CreatedAt      time.Time             `json:"created_at"`
	LastActivityAt time.Time             `json:"last_activity_at"`
	ClosedAt       *time.Time            `json:"closed_at"`
}

// TableName returns the table name
func (BrowserInstanceRecord) TableName() string {
	return "browser_instances"
}
