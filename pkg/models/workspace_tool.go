package models

import (
	"time"
)

// ToolType represents the type of tool
type ToolType string

const (
	ToolTypeMCPStdio       ToolType = "mcp-stdio"
	ToolTypeMCPSSE         ToolType = "mcp-sse"
	ToolTypeMCPHTTP        ToolType = "mcp-http"
	ToolTypeOpenAPI        ToolType = "openapi"
	ToolTypeScript         ToolType = "script"
	ToolTypeBrowserService ToolType = "browser-service"
	ToolTypeBuiltin        ToolType = "builtin"
)

// ToolStatus represents the runtime status of a tool
type ToolStatus string

const (
	ToolStatusRunning ToolStatus = "running"
	ToolStatusStopped ToolStatus = "stopped"
	ToolStatusError   ToolStatus = "error"
)

// WorkspaceTool represents a tool configuration within a workspace
type WorkspaceTool struct {
	ID          string    `json:"id" gorm:"primaryKey;size:36"`
	WorkspaceID string    `json:"workspace_id" gorm:"index;size:36;not null"`
	Name        string    `json:"name" gorm:"size:100;not null"`
	Type        ToolType  `json:"type" gorm:"size:20;not null"`
	Description *string   `json:"description,omitempty" gorm:"size:500"`
	Enabled     bool      `json:"enabled" gorm:"default:true"`
	Config      JSONMap   `json:"config" gorm:"type:json;not null"`
	AIHint      *string   `json:"ai_hint,omitempty" gorm:"type:text"`
	CreatedAt   time.Time `json:"created_at"`
	UpdatedAt   time.Time `json:"updated_at"`
}

// TableName returns the table name for WorkspaceTool
func (WorkspaceTool) TableName() string {
	return "workspace_tools"
}

// RuntimeEnv represents where to run the tool
type RuntimeEnv string

const (
	RuntimeEnvLocal     RuntimeEnv = "local"     // Run on host machine
	RuntimeEnvWorkspace RuntimeEnv = "workspace" // Run in workspace container/pod
)

// MCPStdioConfig represents MCP stdio configuration
type MCPStdioConfig struct {
	Command    string            `json:"command"`
	Args       []string          `json:"args,omitempty"`
	Env        map[string]string `json:"env,omitempty"`
	Cwd        string            `json:"cwd,omitempty"`
	RuntimeEnv RuntimeEnv        `json:"runtime_env,omitempty"` // local or workspace
}

// MCPAuthConfig represents authentication for MCP servers
type MCPAuthConfig struct {
	Type          string            `json:"type"`                     // none, bearer, basic, apiKey, custom
	Token         string            `json:"token,omitempty"`          // For bearer
	Username      string            `json:"username,omitempty"`       // For basic
	Password      string            `json:"password,omitempty"`       // For basic
	APIKey        string            `json:"api_key,omitempty"`        // For apiKey
	APIKeyHeader  string            `json:"api_key_header,omitempty"` // Header name for API key
	CustomHeaders map[string]string `json:"custom_headers,omitempty"` // For custom auth
}

// MCPSSEConfig represents MCP SSE configuration
type MCPSSEConfig struct {
	URL               string            `json:"url"`
	Headers           map[string]string `json:"headers,omitempty"`
	Auth              *MCPAuthConfig    `json:"auth,omitempty"`
	Timeout           int               `json:"timeout,omitempty"`
	Reconnect         *bool             `json:"reconnect,omitempty"`          // Auto-reconnect (default: true)
	ReconnectInterval int               `json:"reconnect_interval,omitempty"` // Reconnect interval in ms
}

// MCPHTTPConfig represents MCP HTTP configuration
type MCPHTTPConfig struct {
	URL     string            `json:"url"`
	Headers map[string]string `json:"headers,omitempty"`
	Auth    *MCPAuthConfig    `json:"auth,omitempty"`
	Timeout int               `json:"timeout,omitempty"`
	Retries int               `json:"retries,omitempty"` // Number of retries on failure
}

// OpenAPIConfig represents OpenAPI configuration
type OpenAPIConfig struct {
	SpecURL     string            `json:"spec_url,omitempty"`
	SpecContent string            `json:"spec_content,omitempty"`
	BaseURL     string            `json:"base_url,omitempty"`
	Headers     map[string]string `json:"headers,omitempty"`
	Auth        *OpenAPIAuth      `json:"auth,omitempty"`
}

// OpenAPIAuth represents OpenAPI authentication configuration
type OpenAPIAuth struct {
	Type         string `json:"type"` // bearer, basic, apiKey
	Token        string `json:"token,omitempty"`
	Username     string `json:"username,omitempty"`
	Password     string `json:"password,omitempty"`
	APIKey       string `json:"api_key,omitempty"`
	APIKeyHeader string `json:"api_key_header,omitempty"`
}

// ScriptConfig represents script configuration
type ScriptConfig struct {
	Runtime    string            `json:"runtime"` // python, node, shell, deno, bun
	Script     string            `json:"script,omitempty"`
	ScriptPath string            `json:"script_path,omitempty"`
	Args       []string          `json:"args,omitempty"`
	Env        map[string]string `json:"env,omitempty"`
	Cwd        string            `json:"cwd,omitempty"`
	Timeout    int               `json:"timeout,omitempty"`
	RuntimeEnv RuntimeEnv        `json:"runtime_env,omitempty"` // local or workspace
}

// BrowserServiceConfig represents browser service configuration
type BrowserServiceConfig struct {
	Provider string                 `json:"provider"` // browserless, browserbase, steel, hyperbrowser, custom
	APIKey   string                 `json:"api_key,omitempty"`
	Endpoint string                 `json:"endpoint,omitempty"`
	Headless *bool                  `json:"headless,omitempty"`
	Timeout  int                    `json:"timeout,omitempty"`
	Viewport *ViewportConfig        `json:"viewport,omitempty"`
	Options  map[string]interface{} `json:"options,omitempty"`
}

// ViewportConfig represents browser viewport configuration
type ViewportConfig struct {
	Width  int `json:"width"`
	Height int `json:"height"`
}

// BuiltinToolOptions contains tool-specific options for builtin tools
type BuiltinToolOptions struct {
	VisionModelID string `json:"vision_model_id,omitempty"` // Model ID for vision analysis (only for browser_get_visual_state)
}

// BuiltinConfig represents built-in tool configuration
type BuiltinConfig struct {
	ToolID        string              `json:"tool_id"`                   // Built-in tool ID (e.g., "mysql_query", "workspace_exec_command")
	ToolIDs       []string            `json:"tool_ids,omitempty"`        // Multiple tool IDs
	SystemToolRef *string             `json:"system_tool_ref,omitempty"` // Reference to a SystemTool ID (for reusing system-level config)
	Options       *BuiltinToolOptions `json:"options,omitempty"`         // Tool-specific options
	SafeMode      bool                `json:"safe_mode,omitempty"`       // If true, restrict to read-only operations
}

// ToolWithStatus represents a tool with its runtime status
type ToolWithStatus struct {
	WorkspaceTool
	Status ToolStatus `json:"status"`
	Error  string     `json:"error,omitempty"`
}
