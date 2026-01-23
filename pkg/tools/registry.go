// Package tools provides built-in tools for AI agents.
// These tools enable AI to interact with workspaces, assets, databases, and file transfers.
package tools

import (
	"fmt"
	"sort"
	"sync"

	"github.com/cloudwego/eino/components/tool"
)

// ToolID identifies a built-in tool
type ToolID string

// Tool categories
const (
	CategoryWorkspace ToolCategory = "workspace"
	CategoryAsset     ToolCategory = "asset"
	CategoryDatabase  ToolCategory = "database"
	CategoryTransfer  ToolCategory = "transfer"
	CategoryBrowser   ToolCategory = "browser"
	CategoryMemory    ToolCategory = "memory"
)

// ToolCategory represents the category of a tool
type ToolCategory string

// ToolScope defines where a tool can be used
type ToolScope string

const (
	// ScopeWorkspace - tool requires workspace context (e.g., workspace_exec)
	ScopeWorkspace ToolScope = "workspace"
	// ScopeGlobal - tool can be used globally without workspace (e.g., asset_fs)
	ScopeGlobal ToolScope = "global"
	// ScopeBoth - tool works in both contexts
	ScopeBoth ToolScope = "both"
)

// ToolDefinition describes a built-in tool
type ToolDefinition struct {
	ID          ToolID       `json:"id"`
	Name        string       `json:"name"`
	Description string       `json:"description"`
	Category    ToolCategory `json:"category"`
	Scope       ToolScope    `json:"scope"`        // Where this tool can be used
	Dangerous   bool         `json:"dangerous"`    // Whether this tool can modify data
	RequiresEnv []string     `json:"requires_env"` // Required environment (e.g., "docker", "ssh")
}

// ToolFactory is a function that creates a tool instance
type ToolFactory func(ctx *ToolContext) tool.InvokableTool

// Registry manages built-in tools
type Registry struct {
	definitions map[ToolID]ToolDefinition
	factories   map[ToolID]ToolFactory
	mu          sync.RWMutex
}

// Global registry instance
var globalRegistry = &Registry{
	definitions: make(map[ToolID]ToolDefinition),
	factories:   make(map[ToolID]ToolFactory),
}

// Register registers a tool with its definition and factory
func Register(def ToolDefinition, factory ToolFactory) {
	globalRegistry.mu.Lock()
	defer globalRegistry.mu.Unlock()

	// Set default scope if not specified
	if def.Scope == "" {
		def.Scope = ScopeBoth
	}

	globalRegistry.definitions[def.ID] = def
	globalRegistry.factories[def.ID] = factory
}

// GetTool returns an invokable tool by ID
func GetTool(id ToolID, ctx *ToolContext) (tool.InvokableTool, error) {
	globalRegistry.mu.RLock()
	defer globalRegistry.mu.RUnlock()

	factory, exists := globalRegistry.factories[id]
	if !exists {
		return nil, fmt.Errorf("unknown tool: %s", id)
	}
	return factory(ctx), nil
}

// GetToolDefinition returns a tool definition by ID
func GetToolDefinition(id ToolID) (ToolDefinition, bool) {
	globalRegistry.mu.RLock()
	defer globalRegistry.mu.RUnlock()
	def, ok := globalRegistry.definitions[id]
	return def, ok
}

// ListToolDefinitions returns all available tool definitions sorted by category and name
func ListToolDefinitions() []ToolDefinition {
	globalRegistry.mu.RLock()
	defer globalRegistry.mu.RUnlock()

	result := make([]ToolDefinition, 0, len(globalRegistry.definitions))
	for _, def := range globalRegistry.definitions {
		result = append(result, def)
	}

	// Sort by category, then by name
	sort.Slice(result, func(i, j int) bool {
		if result[i].Category != result[j].Category {
			return result[i].Category < result[j].Category
		}
		return result[i].Name < result[j].Name
	})

	return result
}

// ListToolsByCategory returns tools filtered by category
func ListToolsByCategory(category ToolCategory) []ToolDefinition {
	globalRegistry.mu.RLock()
	defer globalRegistry.mu.RUnlock()

	var result []ToolDefinition
	for _, def := range globalRegistry.definitions {
		if def.Category == category {
			result = append(result, def)
		}
	}

	sort.Slice(result, func(i, j int) bool {
		return result[i].Name < result[j].Name
	})

	return result
}

// ListToolsByScope returns tools filtered by scope
func ListToolsByScope(scope ToolScope) []ToolDefinition {
	globalRegistry.mu.RLock()
	defer globalRegistry.mu.RUnlock()

	var result []ToolDefinition
	for _, def := range globalRegistry.definitions {
		if def.Scope == scope || def.Scope == ScopeBoth {
			result = append(result, def)
		}
	}

	sort.Slice(result, func(i, j int) bool {
		if result[i].Category != result[j].Category {
			return result[i].Category < result[j].Category
		}
		return result[i].Name < result[j].Name
	})

	return result
}

// ListSafeTools returns only non-dangerous tools (read-only operations)
func ListSafeTools() []ToolDefinition {
	globalRegistry.mu.RLock()
	defer globalRegistry.mu.RUnlock()

	var result []ToolDefinition
	for _, def := range globalRegistry.definitions {
		if !def.Dangerous {
			result = append(result, def)
		}
	}
	return result
}

// GetAllTools returns all tools with the given context
func GetAllTools(ctx *ToolContext) []tool.InvokableTool {
	globalRegistry.mu.RLock()
	defer globalRegistry.mu.RUnlock()

	tools := make([]tool.InvokableTool, 0, len(globalRegistry.factories))
	for _, factory := range globalRegistry.factories {
		tools = append(tools, factory(ctx))
	}
	return tools
}

// GetToolsByIDs returns tools for specific IDs
func GetToolsByIDs(ids []ToolID, ctx *ToolContext) []tool.InvokableTool {
	globalRegistry.mu.RLock()
	defer globalRegistry.mu.RUnlock()

	var tools []tool.InvokableTool
	for _, id := range ids {
		if factory, ok := globalRegistry.factories[id]; ok {
			tools = append(tools, factory(ctx))
		}
	}
	return tools
}

// GetToolsByCategory returns all tools for a category
func GetToolsByCategory(category ToolCategory, ctx *ToolContext) []tool.InvokableTool {
	globalRegistry.mu.RLock()
	defer globalRegistry.mu.RUnlock()

	var tools []tool.InvokableTool
	for id, def := range globalRegistry.definitions {
		if def.Category == category {
			if factory, ok := globalRegistry.factories[id]; ok {
				tools = append(tools, factory(ctx))
			}
		}
	}
	return tools
}

// IsRegistered checks if a tool ID is registered
func IsRegistered(id ToolID) bool {
	globalRegistry.mu.RLock()
	defer globalRegistry.mu.RUnlock()
	_, exists := globalRegistry.definitions[id]
	return exists
}
