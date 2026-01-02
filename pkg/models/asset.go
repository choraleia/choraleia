package models

import (
	"encoding/json"
	"time"
)

// AssetType asset type enum
type AssetType string

const (
	AssetTypeFolder     AssetType = "folder"      // folder container
	AssetTypeLocal      AssetType = "local"       // local terminal
	AssetTypeSSH        AssetType = "ssh"         // SSH connection
	AssetTypeDockerHost AssetType = "docker_host" // Docker Host (dynamic containers)
)

// Asset generic asset structure (linked list for sibling ordering)
type Asset struct {
	ID          string                 `json:"id" gorm:"primaryKey"`
	Name        string                 `json:"name" gorm:"not null"`
	Type        AssetType              `json:"type" gorm:"not null"`
	Description string                 `json:"description"`
	Config      map[string]interface{} `json:"config" gorm:"type:json"`
	Tags        []string               `json:"tags" gorm:"type:json"`
	ParentID    *string                `json:"parent_id" gorm:"index"` // parent node ID (nil=root)
	PrevID      *string                `json:"prev_id"`                // previous sibling id
	NextID      *string                `json:"next_id"`                // next sibling id
	CreatedAt   time.Time              `json:"created_at"`
	UpdatedAt   time.Time              `json:"updated_at"`
}

// SSHConfig SSH connection config
type SSHConfig struct {
	Host                 string `json:"host"`
	Port                 int    `json:"port"`
	Username             string `json:"username"`
	Password             string `json:"password,omitempty"`
	PrivateKey           string `json:"private_key,omitempty"`
	PrivateKeyPath       string `json:"private_key_path,omitempty"`
	PrivateKeyPassphrase string `json:"private_key_passphrase,omitempty"` // added passphrase field
	ProxyJump            string `json:"proxy_jump,omitempty"`
	Timeout              int    `json:"timeout"`
}

// LocalConfig local terminal config
type LocalConfig struct {
	Shell       string            `json:"shell"`
	WorkingDir  string            `json:"working_dir"`
	Environment map[string]string `json:"environment"`
}

// VNCConfig VNC connection config
type VNCConfig struct {
	Host     string `json:"host"`
	Port     int    `json:"port"`
	Password string `json:"password,omitempty"`
	ViewOnly bool   `json:"view_only"`
}

// RDPConfig RDP connection config
type RDPConfig struct {
	Host     string `json:"host"`
	Port     int    `json:"port"`
	Username string `json:"username"`
	Password string `json:"password,omitempty"`
	Domain   string `json:"domain,omitempty"`
	Width    int    `json:"width"`
	Height   int    `json:"height"`
}

// DatabaseConfig database connection config
type DatabaseConfig struct {
	Host     string `json:"host"`
	Port     int    `json:"port"`
	Username string `json:"username"`
	Password string `json:"password,omitempty"`
	Database string `json:"database,omitempty"`
	SSL      bool   `json:"ssl"`
	Timeout  int    `json:"timeout"`
}

// DockerHostConfig docker host connection config
//
// ConnectionType: "local" (use local docker daemon) or "ssh" (via SSH tunnel)
// SSHAssetID: when ConnectionType is "ssh", reference to SSH asset for remote docker
// Shell: default shell for docker exec (e.g. /bin/sh, /bin/bash)
// ShowAllContainers: whether to show stopped containers
type DockerHostConfig struct {
	ConnectionType    string `json:"connection_type"`        // "local" or "ssh"
	SSHAssetID        string `json:"ssh_asset_id,omitempty"` // SSH asset ID for remote docker
	Shell             string `json:"shell,omitempty"`        // default shell for exec
	ShowAllContainers bool   `json:"show_all_containers"`    // include stopped containers
	User              string `json:"user,omitempty"`         // default user for exec
}

// ContainerInfo represents a Docker container's basic info
type ContainerInfo struct {
	ID      string `json:"id"`
	Name    string `json:"name"`
	Image   string `json:"image"`
	State   string `json:"state"`  // running, paused, exited, created
	Status  string `json:"status"` // e.g. "Up 2 hours"
	Ports   string `json:"ports"`
	Created string `json:"created"`
}

// CreateAssetRequest create asset request
type CreateAssetRequest struct {
	Name        string                 `json:"name" binding:"required"`
	Type        AssetType              `json:"type" binding:"required"`
	Description string                 `json:"description"`
	Config      map[string]interface{} `json:"config" binding:"required"`
	Tags        []string               `json:"tags"`
	ParentID    *string                `json:"parent_id"` // parent node ID
}

// UpdateAssetRequest update asset request
type UpdateAssetRequest struct {
	Name        *string                `json:"name"`
	Description *string                `json:"description"`
	Config      map[string]interface{} `json:"config"`
	Tags        []string               `json:"tags"`
}

// MoveAssetRequest move operation request
type MoveAssetRequest struct {
	NewParentID     *string `json:"new_parent_id"`               // target parent (nil=root)
	TargetSiblingID *string `json:"target_sibling_id,omitempty"` // reference sibling id
	Position        string  `json:"position"`                    // before|after|append
}

// AssetListResponse asset list response
type AssetListResponse struct {
	Assets []Asset `json:"assets"`
	Total  int     `json:"total"`
}

// Response common response structure
type Response struct {
	Code    int         `json:"code"`
	Message string      `json:"message"`
	Data    interface{} `json:"data,omitempty"`
}

// ParsedSSHHost parsed SSH host info
type ParsedSSHHost struct {
	Host         string `json:"host"`
	HostName     string `json:"hostname"`
	Port         int    `json:"port"`
	User         string `json:"user"`
	IdentityFile string `json:"identity_file"`
	ProxyJump    string `json:"proxy_jump"`
}

// SSHKeyInfo represents an SSH private key file and whether it's encrypted
type SSHKeyInfo struct {
	Path      string `json:"path"`
	Encrypted bool   `json:"encrypted"`
}

// ValidateConfig validate config based on type
func (a *Asset) ValidateConfig() error {
	switch a.Type {
	case AssetTypeFolder:
		return a.validateFolderConfig()
	case AssetTypeSSH:
		return a.validateSSHConfig()
	case AssetTypeLocal:
		return a.validateLocalConfig()
	case AssetTypeDockerHost:
		return a.validateDockerHostConfig()
	}
	return nil
}

func (a *Asset) validateFolderConfig() error     { return nil }
func (a *Asset) validateSSHConfig() error        { return nil }
func (a *Asset) validateLocalConfig() error      { return nil }
func (a *Asset) validateDockerHostConfig() error { return nil }

// GetTypedConfig decode generic map config into target struct
func (a *Asset) GetTypedConfig(target interface{}) error {
	configBytes, err := json.Marshal(a.Config)
	if err != nil {
		return err
	}
	return json.Unmarshal(configBytes, target)
}
