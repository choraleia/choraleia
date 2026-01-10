// Package tools provides a service layer for built-in tools management.
package tools

import (
	"context"
	"fmt"

	"github.com/cloudwego/eino/components/tool"
)

// BuiltinToolInfo represents detailed information about a built-in tool
type BuiltinToolInfo struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Description string `json:"description"`
	Category    string `json:"category"`
	Scope       string `json:"scope"`
	Dangerous   bool   `json:"dangerous"`
}

// BuiltinToolsService provides built-in tools management for system settings
type BuiltinToolsService struct {
	ctx *ToolContext
}

// NewBuiltinToolsService creates a new built-in tools service
func NewBuiltinToolsService(ctx *ToolContext) *BuiltinToolsService {
	return &BuiltinToolsService{ctx: ctx}
}

// ListAll returns all built-in tools info for system settings display
func (s *BuiltinToolsService) ListAll() []BuiltinToolInfo {
	defs := ListToolDefinitions()
	result := make([]BuiltinToolInfo, len(defs))
	for i, def := range defs {
		result[i] = BuiltinToolInfo{
			ID:          string(def.ID),
			Name:        def.Name,
			Description: def.Description,
			Category:    string(def.Category),
			Scope:       string(def.Scope),
			Dangerous:   def.Dangerous,
		}
	}
	return result
}

// ListByCategory returns built-in tools filtered by category
func (s *BuiltinToolsService) ListByCategory(category string) []BuiltinToolInfo {
	defs := ListToolsByCategory(ToolCategory(category))
	result := make([]BuiltinToolInfo, len(defs))
	for i, def := range defs {
		result[i] = BuiltinToolInfo{
			ID:          string(def.ID),
			Name:        def.Name,
			Description: def.Description,
			Category:    string(def.Category),
			Scope:       string(def.Scope),
			Dangerous:   def.Dangerous,
		}
	}
	return result
}

// ListForWorkspace returns tools suitable for workspace context
func (s *BuiltinToolsService) ListForWorkspace() []BuiltinToolInfo {
	defs := ListToolsByScope(ScopeWorkspace)
	// Also include tools that work in both scopes
	bothDefs := ListToolsByScope(ScopeBoth)

	seen := make(map[ToolID]bool)
	var allDefs []ToolDefinition

	for _, def := range defs {
		if !seen[def.ID] {
			seen[def.ID] = true
			allDefs = append(allDefs, def)
		}
	}
	for _, def := range bothDefs {
		if !seen[def.ID] {
			seen[def.ID] = true
			allDefs = append(allDefs, def)
		}
	}

	result := make([]BuiltinToolInfo, len(allDefs))
	for i, def := range allDefs {
		result[i] = BuiltinToolInfo{
			ID:          string(def.ID),
			Name:        def.Name,
			Description: def.Description,
			Category:    string(def.Category),
			Scope:       string(def.Scope),
			Dangerous:   def.Dangerous,
		}
	}
	return result
}

// ListGlobal returns tools that don't require workspace context
func (s *BuiltinToolsService) ListGlobal() []BuiltinToolInfo {
	defs := ListToolsByScope(ScopeGlobal)
	result := make([]BuiltinToolInfo, len(defs))
	for i, def := range defs {
		result[i] = BuiltinToolInfo{
			ID:          string(def.ID),
			Name:        def.Name,
			Description: def.Description,
			Category:    string(def.Category),
			Scope:       string(def.Scope),
			Dangerous:   def.Dangerous,
		}
	}
	return result
}

// ListSafe returns only non-dangerous (read-only) tools
func (s *BuiltinToolsService) ListSafe() []BuiltinToolInfo {
	defs := ListSafeTools()
	result := make([]BuiltinToolInfo, len(defs))
	for i, def := range defs {
		result[i] = BuiltinToolInfo{
			ID:          string(def.ID),
			Name:        def.Name,
			Description: def.Description,
			Category:    string(def.Category),
			Scope:       string(def.Scope),
			Dangerous:   def.Dangerous,
		}
	}
	return result
}

// GetToolInfo returns info for a specific tool
func (s *BuiltinToolsService) GetToolInfo(id string) (*BuiltinToolInfo, error) {
	def, ok := GetToolDefinition(ToolID(id))
	if !ok {
		return nil, fmt.Errorf("built-in tool not found: %s", id)
	}
	return &BuiltinToolInfo{
		ID:          string(def.ID),
		Name:        def.Name,
		Description: def.Description,
		Category:    string(def.Category),
		Scope:       string(def.Scope),
		Dangerous:   def.Dangerous,
	}, nil
}

// GetCategories returns all available categories
func (s *BuiltinToolsService) GetCategories() []string {
	return []string{
		string(CategoryWorkspace),
		string(CategoryAsset),
		string(CategoryDatabase),
		string(CategoryTransfer),
	}
}

// ValidateToolID checks if a tool ID is valid
func (s *BuiltinToolsService) ValidateToolID(id string) bool {
	return IsRegistered(ToolID(id))
}

// CreateToolsForWorkspace creates invokable tools for a workspace
// enabledToolIDs: list of tool IDs to enable (nil means all tools)
// safeOnly: only include non-dangerous tools
func (s *BuiltinToolsService) CreateToolsForWorkspace(
	ctx context.Context,
	workspaceID string,
	conversationID string,
	enabledToolIDs []string,
	safeOnly bool,
) ([]tool.InvokableTool, error) {
	// Create workspace-scoped context with conversation ID
	toolCtx := s.ctx.WithWorkspace(workspaceID).WithConversation(conversationID)

	// Get tool definitions to filter
	var defs []ToolDefinition
	if enabledToolIDs != nil {
		// Only get specified tools
		for _, id := range enabledToolIDs {
			def, ok := GetToolDefinition(ToolID(id))
			if ok {
				defs = append(defs, def)
			}
		}
	} else {
		// Get all workspace-compatible tools
		defs = ListToolsByScope(ScopeWorkspace)
		bothDefs := ListToolsByScope(ScopeBoth)
		seen := make(map[ToolID]bool)
		for _, def := range defs {
			seen[def.ID] = true
		}
		for _, def := range bothDefs {
			if !seen[def.ID] {
				defs = append(defs, def)
			}
		}
	}

	// Filter and create tools
	var tools []tool.InvokableTool
	for _, def := range defs {
		if safeOnly && def.Dangerous {
			continue
		}

		t, err := GetTool(def.ID, toolCtx)
		if err != nil {
			continue
		}
		tools = append(tools, t)
	}

	return tools, nil
}

// CreateGlobalTools creates invokable tools for global (non-workspace) use
func (s *BuiltinToolsService) CreateGlobalTools(
	enabledToolIDs []string,
	safeOnly bool,
) ([]tool.InvokableTool, error) {
	// Get tool definitions to filter
	var defs []ToolDefinition
	if enabledToolIDs != nil {
		for _, id := range enabledToolIDs {
			def, ok := GetToolDefinition(ToolID(id))
			if ok && (def.Scope == ScopeGlobal || def.Scope == ScopeBoth) {
				defs = append(defs, def)
			}
		}
	} else {
		defs = ListToolsByScope(ScopeGlobal)
	}

	// Filter and create tools
	var tools []tool.InvokableTool
	for _, def := range defs {
		if safeOnly && def.Dangerous {
			continue
		}

		t, err := GetTool(def.ID, s.ctx)
		if err != nil {
			continue
		}
		tools = append(tools, t)
	}

	return tools, nil
}
