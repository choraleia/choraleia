package models

import (
	"encoding/json"
	"fmt"
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
	// Connection
	Host                 string `json:"host"`
	Port                 int    `json:"port"`
	Username             string `json:"username"`
	Password             string `json:"password,omitempty"`
	PrivateKeyPath       string `json:"private_key_path,omitempty"`
	PrivateKeyPassphrase string `json:"private_key_passphrase,omitempty"`
	PrivateKey           string `json:"private_key,omitempty"`
	Timeout              int    `json:"timeout"`
	KeepaliveInterval    int    `json:"keepalive_interval,omitempty"`

	// Connection mode: direct, proxy, jump
	ConnectionMode string `json:"connection_mode,omitempty"` // "direct", "proxy", "jump"

	// Proxy settings (for proxy mode)
	ProxyType     string `json:"proxy_type,omitempty"` // "http", "socks4", "socks5"
	ProxyHost     string `json:"proxy_host,omitempty"`
	ProxyPort     int    `json:"proxy_port,omitempty"`
	ProxyUsername string `json:"proxy_username,omitempty"`
	ProxyPassword string `json:"proxy_password,omitempty"`

	// Jump host settings (for jump mode)
	JumpAssetID string `json:"jump_asset_id,omitempty"`

	// Legacy field for backward compatibility
	ProxyJump string `json:"proxy_jump,omitempty"`

	// Advanced connection
	Compression     bool `json:"compression,omitempty"`
	AgentForwarding bool `json:"agent_forwarding,omitempty"`
	StrictHostKey   bool `json:"strict_host_key,omitempty"`

	// Tunnels / Port forwarding
	Tunnels []SSHTunnel `json:"tunnels,omitempty"`

	// Terminal settings
	Shell          string            `json:"shell,omitempty"`
	TermType       string            `json:"term_type,omitempty"`
	StartupCommand string            `json:"startup_command,omitempty"`
	Environment    map[string]string `json:"environment,omitempty"`

	// Terminal preferences
	Scrollback   int  `json:"scrollback,omitempty"`
	FontSize     int  `json:"font_size,omitempty"`
	CopyOnSelect bool `json:"copy_on_select,omitempty"`
	Bell         bool `json:"bell,omitempty"`
}

// SSHTunnel represents a port forwarding tunnel configuration
type SSHTunnel struct {
	ID         string `json:"id,omitempty"`         // unique tunnel ID (auto-generated if empty)
	Type       string `json:"type"`                 // "local", "remote", "dynamic"
	LocalHost  string `json:"local_host,omitempty"` // default "127.0.0.1"
	LocalPort  int    `json:"local_port"`
	RemoteHost string `json:"remote_host,omitempty"` // not used for dynamic
	RemotePort int    `json:"remote_port,omitempty"` // not used for dynamic
}

// LocalConfig local terminal config
type LocalConfig struct {
	Shell          string            `json:"shell"`
	WorkingDir     string            `json:"working_dir,omitempty"`
	StartupCommand string            `json:"startup_command,omitempty"`
	Environment    map[string]string `json:"environment,omitempty"`
	InheritEnv     bool              `json:"inherit_env,omitempty"`
	TermType       string            `json:"term_type,omitempty"`
	LoginShell     bool              `json:"login_shell,omitempty"`
	Scrollback     int               `json:"scrollback,omitempty"`
	FontSize       int               `json:"font_size,omitempty"`
	CopyOnSelect   bool              `json:"copy_on_select,omitempty"`
	Bell           bool              `json:"bell,omitempty"`
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
	User              string `json:"user,omitempty"`         // default user for exec
	ShowAllContainers bool   `json:"show_all_containers"`    // include stopped containers
	TermType          string `json:"term_type,omitempty"`
	Scrollback        int    `json:"scrollback,omitempty"`
	FontSize          int    `json:"font_size,omitempty"`
	CopyOnSelect      bool   `json:"copy_on_select,omitempty"`
	Bell              bool   `json:"bell,omitempty"`
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

func (a *Asset) validateFolderConfig() error {
	// Folder type has no required config fields
	return nil
}

func (a *Asset) validateSSHConfig() error {
	var cfg SSHConfig
	if err := a.GetTypedConfig(&cfg); err != nil {
		return fmt.Errorf("invalid SSH config format: %w", err)
	}

	// Required fields
	if cfg.Host == "" {
		return fmt.Errorf("host is required")
	}
	if cfg.Username == "" {
		return fmt.Errorf("username is required")
	}

	// Port validation
	if cfg.Port < 0 || cfg.Port > 65535 {
		return fmt.Errorf("port must be between 0 and 65535")
	}

	// Timeout validation
	if cfg.Timeout < 0 {
		return fmt.Errorf("timeout must be non-negative")
	}

	// Keepalive validation
	if cfg.KeepaliveInterval < 0 {
		return fmt.Errorf("keepalive_interval must be non-negative")
	}

	// Connection mode validation
	if cfg.ConnectionMode != "" {
		validModes := []string{"direct", "proxy", "jump"}
		valid := false
		for _, m := range validModes {
			if cfg.ConnectionMode == m {
				valid = true
				break
			}
		}
		if !valid {
			return fmt.Errorf("connection_mode must be one of: direct, proxy, jump")
		}
	}

	// Proxy validation
	if cfg.ConnectionMode == "proxy" {
		if cfg.ProxyHost == "" {
			return fmt.Errorf("proxy_host is required when connection_mode is proxy")
		}
		if cfg.ProxyType != "" {
			validTypes := []string{"http", "socks4", "socks5"}
			valid := false
			for _, t := range validTypes {
				if cfg.ProxyType == t {
					valid = true
					break
				}
			}
			if !valid {
				return fmt.Errorf("proxy_type must be one of: http, socks4, socks5")
			}
		}
		if cfg.ProxyPort < 0 || cfg.ProxyPort > 65535 {
			return fmt.Errorf("proxy_port must be between 0 and 65535")
		}
	}

	// Jump host validation
	if cfg.ConnectionMode == "jump" && cfg.JumpAssetID == "" {
		return fmt.Errorf("jump_asset_id is required when connection_mode is jump")
	}

	// Tunnel validation
	for i, tunnel := range cfg.Tunnels {
		if tunnel.Type == "" {
			return fmt.Errorf("tunnel[%d]: type is required", i)
		}
		validTypes := []string{"local", "remote", "dynamic"}
		valid := false
		for _, t := range validTypes {
			if tunnel.Type == t {
				valid = true
				break
			}
		}
		if !valid {
			return fmt.Errorf("tunnel[%d]: type must be one of: local, remote, dynamic", i)
		}

		if tunnel.LocalPort <= 0 || tunnel.LocalPort > 65535 {
			return fmt.Errorf("tunnel[%d]: local_port must be between 1 and 65535", i)
		}

		if tunnel.Type != "dynamic" {
			if tunnel.RemoteHost == "" {
				return fmt.Errorf("tunnel[%d]: remote_host is required for %s tunnel", i, tunnel.Type)
			}
			if tunnel.RemotePort <= 0 || tunnel.RemotePort > 65535 {
				return fmt.Errorf("tunnel[%d]: remote_port must be between 1 and 65535", i)
			}
		}
	}

	// Terminal preferences validation
	if cfg.Scrollback < 0 {
		return fmt.Errorf("scrollback must be non-negative")
	}
	if cfg.FontSize < 0 {
		return fmt.Errorf("font_size must be non-negative")
	}

	return nil
}

func (a *Asset) validateLocalConfig() error {
	var cfg LocalConfig
	if err := a.GetTypedConfig(&cfg); err != nil {
		return fmt.Errorf("invalid Local config format: %w", err)
	}

	// Shell is optional but if provided, should be a valid path
	if cfg.Shell != "" && !isValidShellPath(cfg.Shell) {
		return fmt.Errorf("shell must be a valid executable path")
	}

	// Working directory validation
	if cfg.WorkingDir != "" {
		// Just check it's not obviously invalid
		if cfg.WorkingDir != "" && cfg.WorkingDir[0] != '/' && cfg.WorkingDir[0] != '~' {
			// Allow relative paths but warn about absolute paths being preferred
		}
	}

	// Terminal preferences validation
	if cfg.Scrollback < 0 {
		return fmt.Errorf("scrollback must be non-negative")
	}
	if cfg.FontSize < 0 {
		return fmt.Errorf("font_size must be non-negative")
	}

	return nil
}

func (a *Asset) validateDockerHostConfig() error {
	var cfg DockerHostConfig
	if err := a.GetTypedConfig(&cfg); err != nil {
		return fmt.Errorf("invalid DockerHost config format: %w", err)
	}

	// Connection type validation
	if cfg.ConnectionType != "" {
		if cfg.ConnectionType != "local" && cfg.ConnectionType != "ssh" {
			return fmt.Errorf("connection_type must be 'local' or 'ssh'")
		}
	}

	// SSH asset ID required for SSH connection type
	if cfg.ConnectionType == "ssh" && cfg.SSHAssetID == "" {
		return fmt.Errorf("ssh_asset_id is required when connection_type is ssh")
	}

	// Shell validation
	if cfg.Shell != "" && !isValidShellPath(cfg.Shell) {
		return fmt.Errorf("shell must be a valid executable path")
	}

	// Terminal preferences validation
	if cfg.Scrollback < 0 {
		return fmt.Errorf("scrollback must be non-negative")
	}
	if cfg.FontSize < 0 {
		return fmt.Errorf("font_size must be non-negative")
	}

	return nil
}

// isValidShellPath checks if shell path looks valid
func isValidShellPath(shell string) bool {
	if shell == "" {
		return false
	}
	// Must start with / or be a simple command name
	if shell[0] == '/' {
		return true
	}
	// Allow common shell names without path
	commonShells := []string{"sh", "bash", "zsh", "ash", "fish", "dash", "ksh", "csh", "tcsh"}
	for _, s := range commonShells {
		if shell == s {
			return true
		}
	}
	return true // Allow other paths, let system handle invalid ones
}

// GetTypedConfig decode generic map config into target struct
func (a *Asset) GetTypedConfig(target interface{}) error {
	configBytes, err := json.Marshal(a.Config)
	if err != nil {
		return err
	}
	return json.Unmarshal(configBytes, target)
}
