// Package tools provides tool loading and management for workspaces
package tools

import (
	"context"
	"encoding/json"
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

	// Parse config into BuiltinConfig struct
	builtinCfg, err := a.parseBuiltinConfig(cfg.Config)
	if err != nil {
		return nil, fmt.Errorf("failed to parse builtin config: %w", err)
	}

	// Build tool options
	options := &ToolOptions{
		SafeMode: builtinCfg.SafeMode,
	}
	if builtinCfg.Options != nil {
		options.VisionModelID = builtinCfg.Options.VisionModelID
	}

	// Collect tool IDs
	var toolIDs []string
	if len(builtinCfg.ToolIDs) > 0 {
		toolIDs = builtinCfg.ToolIDs
	} else if builtinCfg.ToolID != "" {
		toolIDs = []string{builtinCfg.ToolID}
	}

	if len(toolIDs) == 0 {
		return nil, fmt.Errorf("builtin tool config missing toolId or tool_ids")
	}

	a.logger.Debug("Loading builtin tools",
		"toolIDs", toolIDs,
		"visionModelID", options.VisionModelID,
		"safeMode", options.SafeMode)

	return a.builtinService.CreateToolsForWorkspace(ctx, workspaceID, conversationID, toolIDs, options)
}

// parseBuiltinConfig parses the config map into BuiltinConfig struct
func (a *ToolLoaderAdapter) parseBuiltinConfig(config models.JSONMap) (*models.BuiltinConfig, error) {
	// Check for nested "builtin" key first (frontend format)
	configToUse := config
	if builtinRaw, ok := config["builtin"]; ok {
		if builtinMap, ok := builtinRaw.(map[string]interface{}); ok {
			configToUse = models.JSONMap(builtinMap)
		}
	}

	// Convert to JSON and unmarshal to struct
	jsonBytes, err := json.Marshal(configToUse)
	if err != nil {
		return nil, err
	}

	var builtinCfg models.BuiltinConfig
	if err := json.Unmarshal(jsonBytes, &builtinCfg); err != nil {
		return nil, err
	}

	// Handle frontend's "toolId" (camelCase) vs backend's "tool_id" (snake_case)
	if builtinCfg.ToolID == "" {
		if toolID, ok := configToUse["toolId"].(string); ok {
			builtinCfg.ToolID = toolID
		}
	}

	return &builtinCfg, nil
}

// Helper function to get map keys (for debug logging)
func getMapKeys(m models.JSONMap) []string {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	return keys
}
