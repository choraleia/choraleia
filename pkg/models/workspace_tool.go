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

// MCPStdioConfig represents MCP stdio configuration
type MCPStdioConfig struct {
	Command string            `json:"command"`
	Args    []string          `json:"args,omitempty"`
	Env     map[string]string `json:"env,omitempty"`
	Cwd     string            `json:"cwd,omitempty"`
}

// MCPSSEConfig represents MCP SSE configuration
type MCPSSEConfig struct {
	URL     string            `json:"url"`
	Headers map[string]string `json:"headers,omitempty"`
	Timeout int               `json:"timeout,omitempty"`
}

// MCPHTTPConfig represents MCP HTTP configuration
type MCPHTTPConfig struct {
	URL     string            `json:"url"`
	Headers map[string]string `json:"headers,omitempty"`
	Timeout int               `json:"timeout,omitempty"`
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

// BuiltinConfig represents built-in tool configuration
type BuiltinConfig struct {
	ToolID  string                 `json:"tool_id"`
	Options map[string]interface{} `json:"options,omitempty"`
}

// ToolWithStatus represents a tool with its runtime status
type ToolWithStatus struct {
	WorkspaceTool
	Status ToolStatus `json:"status"`
	Error  string     `json:"error,omitempty"`
}
