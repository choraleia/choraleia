// Package tools provides tool loading and management for workspaces
package tools

import (
	"context"
	"fmt"
	"log/slog"

	"github.com/choraleia/choraleia/pkg/models"
	"github.com/choraleia/choraleia/pkg/utils"
	"github.com/cloudwego/eino/components/tool"
)

// ToolLoaderAdapter implements the ToolLoader interface from ChatService
type ToolLoaderAdapter struct {
	builtinService *BuiltinToolsService
	logger         *slog.Logger
}

// NewToolLoaderAdapter creates a new tool loader adapter
func NewToolLoaderAdapter(ctx *ToolContext) *ToolLoaderAdapter {
	return &ToolLoaderAdapter{
		builtinService: NewBuiltinToolsService(ctx),
		logger:         utils.GetLogger(),
	}
}

// LoadWorkspaceTools loads tools configured for a workspace
// This implements the ToolLoader interface from ChatService
func (a *ToolLoaderAdapter) LoadWorkspaceTools(
	ctx context.Context,
	workspaceID string,
	conversationID string,
	toolConfigs []models.WorkspaceTool,
) ([]tool.InvokableTool, error) {
	a.logger.Info("LoadWorkspaceTools called",
		"workspaceID", workspaceID,
		"conversationID", conversationID,
		"toolConfigsCount", len(toolConfigs))

	if len(toolConfigs) == 0 {
		a.logger.Warn("No tool configs provided for workspace", "workspaceID", workspaceID)
		return nil, nil
	}

	var tools []tool.InvokableTool

	for _, cfg := range toolConfigs {
		a.logger.Debug("Processing tool config",
			"toolName", cfg.Name,
			"toolType", cfg.Type,
			"enabled", cfg.Enabled,
			"config", cfg.Config)

		// Skip disabled tools
		if !cfg.Enabled {
			a.logger.Debug("Skipping disabled tool", "toolName", cfg.Name)
			continue
		}

		switch cfg.Type {
		case models.ToolTypeBuiltin:
			// Load built-in tools
			builtinTools, err := a.loadBuiltinTools(ctx, workspaceID, conversationID, cfg)
			if err != nil {
				a.logger.Warn("Failed to load builtin tool",
					"toolName", cfg.Name,
					"error", err)
				continue
			}
			a.logger.Info("Loaded builtin tools",
				"toolName", cfg.Name,
				"count", len(builtinTools))
			tools = append(tools, builtinTools...)

		case models.ToolTypeMCPStdio, models.ToolTypeMCPSSE, models.ToolTypeMCPHTTP:
			a.logger.Warn("MCP tools not yet supported", "toolName", cfg.Name, "type", cfg.Type)

		case models.ToolTypeOpenAPI:
			a.logger.Warn("OpenAPI tools not yet supported", "toolName", cfg.Name)

		case models.ToolTypeScript:
			a.logger.Warn("Script tools not yet supported", "toolName", cfg.Name)

		case models.ToolTypeBrowserService:
			a.logger.Warn("Browser service tools not yet supported", "toolName", cfg.Name)

		default:
			a.logger.Warn("Unknown tool type", "toolName", cfg.Name, "type", cfg.Type)
		}
	}

	a.logger.Info("LoadWorkspaceTools completed",
		"workspaceID", workspaceID,
		"totalToolsLoaded", len(tools))

	return tools, nil
}

// loadBuiltinTools loads built-in tools based on configuration
func (a *ToolLoaderAdapter) loadBuiltinTools(
	ctx context.Context,
	workspaceID string,
	conversationID string,
	cfg models.WorkspaceTool,
) ([]tool.InvokableTool, error) {
	a.logger.Debug("loadBuiltinTools called",
		"workspaceID", workspaceID,
		"conversationID", conversationID,
		"toolName", cfg.Name,
		"config", cfg.Config)

	// Get the config map to search in
	// Frontend sends: { builtin: { toolId: "xxx" } } - nested format
	// or directly: { toolId: "xxx" } - flat format
	configToSearch := cfg.Config

	// Check for nested "builtin" key first
	if builtinRaw, ok := cfg.Config["builtin"]; ok {
		if builtinConfig, ok := builtinRaw.(map[string]interface{}); ok {
			a.logger.Debug("Found nested builtin config", "builtinConfig", builtinConfig)
			configToSearch = models.JSONMap(builtinConfig)
		}
	}

	// First try "tool_ids" (array)
	if toolIDsRaw, ok := configToSearch["tool_ids"]; ok {
		var toolIDs []string
		switch v := toolIDsRaw.(type) {
		case []interface{}:
			for _, id := range v {
				if idStr, ok := id.(string); ok {
					toolIDs = append(toolIDs, idStr)
				}
			}
		case []string:
			toolIDs = v
		default:
			a.logger.Warn("tool_ids has unexpected type",
				"type", fmt.Sprintf("%T", toolIDsRaw))
		}
		if len(toolIDs) > 0 {
			a.logger.Debug("Loading builtin tools from tool_ids", "toolIDs", toolIDs)
			safeOnly := getBoolConfig(configToSearch, "safe_only", false)
			return a.builtinService.CreateToolsForWorkspace(ctx, workspaceID, conversationID, toolIDs, safeOnly)
		}
	}

	// Then try "toolId" (frontend format - single tool)
	if toolIDRaw, ok := configToSearch["toolId"]; ok {
		toolID, ok := toolIDRaw.(string)
		if ok && toolID != "" {
			a.logger.Debug("Loading single builtin tool from toolId", "toolID", toolID)
			safeOnly := getBoolConfig(configToSearch, "safe_only", false)
			return a.builtinService.CreateToolsForWorkspace(ctx, workspaceID, conversationID, []string{toolID}, safeOnly)
		}
	}

	// Legacy: try "tool_id" (snake_case)
	if toolIDRaw, ok := configToSearch["tool_id"]; ok {
		toolID, ok := toolIDRaw.(string)
		if ok && toolID != "" {
			a.logger.Debug("Loading single builtin tool from tool_id", "toolID", toolID)
			safeOnly := getBoolConfig(configToSearch, "safe_only", false)
			return a.builtinService.CreateToolsForWorkspace(ctx, workspaceID, conversationID, []string{toolID}, safeOnly)
		}
	}

	a.logger.Warn("Builtin tool config missing toolId, tool_id, or tool_ids",
		"toolName", cfg.Name,
		"configKeys", getMapKeys(cfg.Config),
		"searchedConfigKeys", getMapKeys(configToSearch))
	return nil, fmt.Errorf("builtin tool config missing toolId, tool_id, or tool_ids")
}

// getBoolConfig safely gets a bool value from config map
func getBoolConfig(config models.JSONMap, key string, defaultVal bool) bool {
	if v, ok := config[key]; ok {
		if b, ok := v.(bool); ok {
			return b
		}
	}
	return defaultVal
}

// Helper function to get map keys
func getMapKeys(m models.JSONMap) []string {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	return keys
}
