// Package asset_fs provides file system tools for remote asset operations.
package asset_fs

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/cloudwego/eino/components/tool"
	"github.com/cloudwego/eino/components/tool/utils"
	"github.com/cloudwego/eino/schema"

	"github.com/choraleia/choraleia/pkg/tools"
)

func init() {
	tools.Register(tools.ToolDefinition{
		ID:          "asset_fs_list",
		Name:        "List Remote Directory",
		Description: "List directory contents on a remote asset (SSH server, docker container)",
		Category:    tools.CategoryAsset,
		Scope:       tools.ScopeGlobal,
		Dangerous:   false,
	}, NewListTool)

	tools.Register(tools.ToolDefinition{
		ID:          "asset_fs_read",
		Name:        "Read Remote File",
		Description: "Read file content from a remote asset",
		Category:    tools.CategoryAsset,
		Scope:       tools.ScopeGlobal,
		Dangerous:   false,
	}, NewReadTool)

	tools.Register(tools.ToolDefinition{
		ID:          "asset_fs_write",
		Name:        "Write Remote File",
		Description: "Write content to a file on a remote asset",
		Category:    tools.CategoryAsset,
		Scope:       tools.ScopeGlobal,
		Dangerous:   true,
	}, NewWriteTool)

	tools.Register(tools.ToolDefinition{
		ID:          "asset_fs_stat",
		Name:        "Remote File Info",
		Description: "Get file or directory information on a remote asset",
		Category:    tools.CategoryAsset,
		Scope:       tools.ScopeGlobal,
		Dangerous:   false,
	}, NewStatTool)

	tools.Register(tools.ToolDefinition{
		ID:          "asset_fs_mkdir",
		Name:        "Create Remote Directory",
		Description: "Create a directory on a remote asset",
		Category:    tools.CategoryAsset,
		Scope:       tools.ScopeGlobal,
		Dangerous:   true,
	}, NewMkdirTool)

	tools.Register(tools.ToolDefinition{
		ID:          "asset_fs_remove",
		Name:        "Remove Remote File/Directory",
		Description: "Remove a file or directory on a remote asset",
		Category:    tools.CategoryAsset,
		Scope:       tools.ScopeGlobal,
		Dangerous:   true,
	}, NewRemoveTool)

	tools.Register(tools.ToolDefinition{
		ID:          "asset_fs_rename",
		Name:        "Rename/Move Remote",
		Description: "Rename or move a file/directory on a remote asset",
		Category:    tools.CategoryAsset,
		Scope:       tools.ScopeGlobal,
		Dangerous:   true,
	}, NewRenameTool)

	tools.Register(tools.ToolDefinition{
		ID:          "asset_fs_copy",
		Name:        "Copy Remote File",
		Description: "Copy a file on a remote asset",
		Category:    tools.CategoryAsset,
		Scope:       tools.ScopeGlobal,
		Dangerous:   true,
	}, NewCopyTool)
}

// getAssetName retrieves the asset name for display
func getAssetName(tc *tools.ToolContext, assetID string) string {
	asset, err := tc.GetAsset(assetID)
	if err != nil {
		return assetID
	}
	return asset.Name
}

// ---- List Directory Tool ----

type ListInput struct {
	AssetID string `json:"asset_id"`
	Path    string `json:"path"`
	All     bool   `json:"all,omitempty"`
}

func NewListTool(tc *tools.ToolContext) tool.InvokableTool {
	return utils.NewTool(&schema.ToolInfo{
		Name: "asset_fs_list",
		Desc: "List directory contents on a remote asset (SSH server, docker container). Specify asset_id to identify the target server.",
		ParamsOneOf: schema.NewParamsOneOfByParams(map[string]*schema.ParameterInfo{
			"asset_id": {Type: schema.String, Required: true, Desc: "Asset ID of the remote server"},
			"path":     {Type: schema.String, Required: true, Desc: "Directory path to list"},
			"all":      {Type: schema.Boolean, Required: false, Desc: "Include hidden files (default: false)"},
		}),
	}, func(ctx context.Context, input *ListInput) (string, error) {
		result, err := tc.ListDir(ctx, tc.AssetEndpoint(input.AssetID), input.Path, input.All)
		if err != nil {
			return "", fmt.Errorf("failed to list directory on %s: %w", getAssetName(tc, input.AssetID), err)
		}

		var sb strings.Builder
		sb.WriteString(fmt.Sprintf("Asset: %s\n", getAssetName(tc, input.AssetID)))
		sb.WriteString(fmt.Sprintf("Directory: %s\n", input.Path))
		sb.WriteString(fmt.Sprintf("Total: %d items\n\n", len(result.Entries)))

		for _, entry := range result.Entries {
			typeStr := "FILE"
			if entry.IsDir {
				typeStr = "DIR "
			}
			sb.WriteString(fmt.Sprintf("%s  %10d  %s  %s\n",
				typeStr, entry.Size, entry.ModTime.Format("2006-01-02 15:04"), entry.Name))
		}

		return sb.String(), nil
	})
}

// ---- Read File Tool ----

type ReadInput struct {
	AssetID  string `json:"asset_id"`
	Path     string `json:"path"`
	MaxBytes *int   `json:"max_bytes,omitempty"`
}

func NewReadTool(tc *tools.ToolContext) tool.InvokableTool {
	return utils.NewTool(&schema.ToolInfo{
		Name: "asset_fs_read",
		Desc: "Read the content of a file on a remote asset. Use for viewing configuration files, logs, or source code on remote servers.",
		ParamsOneOf: schema.NewParamsOneOfByParams(map[string]*schema.ParameterInfo{
			"asset_id":  {Type: schema.String, Required: true, Desc: "Asset ID of the remote server"},
			"path":      {Type: schema.String, Required: true, Desc: "File path to read"},
			"max_bytes": {Type: schema.Integer, Required: false, Desc: "Maximum bytes to read (default: no limit)"},
		}),
	}, func(ctx context.Context, input *ReadInput) (string, error) {
		content, err := tc.ReadFile(ctx, tc.AssetEndpoint(input.AssetID), input.Path)
		if err != nil {
			return "", fmt.Errorf("failed to read file on %s: %w", getAssetName(tc, input.AssetID), err)
		}

		if input.MaxBytes != nil && len(content) > *input.MaxBytes {
			content = content[:*input.MaxBytes] + "\n...[truncated]"
		}

		return fmt.Sprintf("Asset: %s\nFile: %s\n\n%s", getAssetName(tc, input.AssetID), input.Path, content), nil
	})
}

// ---- Write File Tool ----

type WriteInput struct {
	AssetID   string `json:"asset_id"`
	Path      string `json:"path"`
	Content   string `json:"content"`
	Overwrite bool   `json:"overwrite,omitempty"`
}

func NewWriteTool(tc *tools.ToolContext) tool.InvokableTool {
	return utils.NewTool(&schema.ToolInfo{
		Name: "asset_fs_write",
		Desc: "Write content to a file on a remote asset. Creates the file if it doesn't exist.",
		ParamsOneOf: schema.NewParamsOneOfByParams(map[string]*schema.ParameterInfo{
			"asset_id":  {Type: schema.String, Required: true, Desc: "Asset ID of the remote server"},
			"path":      {Type: schema.String, Required: true, Desc: "File path to write"},
			"content":   {Type: schema.String, Required: true, Desc: "Content to write"},
			"overwrite": {Type: schema.Boolean, Required: false, Desc: "Overwrite existing file (default: true)"},
		}),
	}, func(ctx context.Context, input *WriteInput) (string, error) {
		err := tc.WriteFile(ctx, tc.AssetEndpoint(input.AssetID), input.Path, input.Content)
		if err != nil {
			return "", fmt.Errorf("failed to write file on %s: %w", getAssetName(tc, input.AssetID), err)
		}

		return fmt.Sprintf("Successfully wrote %d bytes to %s on %s",
			len(input.Content), input.Path, getAssetName(tc, input.AssetID)), nil
	})
}

// ---- Stat Tool ----

type StatInput struct {
	AssetID string `json:"asset_id"`
	Path    string `json:"path"`
}

func NewStatTool(tc *tools.ToolContext) tool.InvokableTool {
	return utils.NewTool(&schema.ToolInfo{
		Name: "asset_fs_stat",
		Desc: "Get detailed information about a file or directory on a remote asset.",
		ParamsOneOf: schema.NewParamsOneOfByParams(map[string]*schema.ParameterInfo{
			"asset_id": {Type: schema.String, Required: true, Desc: "Asset ID of the remote server"},
			"path":     {Type: schema.String, Required: true, Desc: "File or directory path"},
		}),
	}, func(ctx context.Context, input *StatInput) (string, error) {
		info, err := tc.Stat(ctx, tc.AssetEndpoint(input.AssetID), input.Path)
		if err != nil {
			return "", fmt.Errorf("failed to get file info on %s: %w", getAssetName(tc, input.AssetID), err)
		}

		result := map[string]interface{}{
			"asset":    getAssetName(tc, input.AssetID),
			"name":     info.Name,
			"path":     input.Path,
			"size":     info.Size,
			"is_dir":   info.IsDir,
			"mod_time": info.ModTime.Format("2006-01-02 15:04:05"),
			"mode":     info.Mode,
		}
		data, _ := json.MarshalIndent(result, "", "  ")
		return string(data), nil
	})
}

// ---- Mkdir Tool ----

type MkdirInput struct {
	AssetID string `json:"asset_id"`
	Path    string `json:"path"`
}

func NewMkdirTool(tc *tools.ToolContext) tool.InvokableTool {
	return utils.NewTool(&schema.ToolInfo{
		Name: "asset_fs_mkdir",
		Desc: "Create a directory on a remote asset. Creates parent directories if needed.",
		ParamsOneOf: schema.NewParamsOneOfByParams(map[string]*schema.ParameterInfo{
			"asset_id": {Type: schema.String, Required: true, Desc: "Asset ID of the remote server"},
			"path":     {Type: schema.String, Required: true, Desc: "Directory path to create"},
		}),
	}, func(ctx context.Context, input *MkdirInput) (string, error) {
		err := tc.Mkdir(ctx, tc.AssetEndpoint(input.AssetID), input.Path)
		if err != nil {
			return "", fmt.Errorf("failed to create directory on %s: %w", getAssetName(tc, input.AssetID), err)
		}
		return fmt.Sprintf("Successfully created directory %s on %s", input.Path, getAssetName(tc, input.AssetID)), nil
	})
}

// ---- Remove Tool ----

type RemoveInput struct {
	AssetID string `json:"asset_id"`
	Path    string `json:"path"`
}

func NewRemoveTool(tc *tools.ToolContext) tool.InvokableTool {
	return utils.NewTool(&schema.ToolInfo{
		Name: "asset_fs_remove",
		Desc: "Remove a file or directory on a remote asset. Use with caution.",
		ParamsOneOf: schema.NewParamsOneOfByParams(map[string]*schema.ParameterInfo{
			"asset_id": {Type: schema.String, Required: true, Desc: "Asset ID of the remote server"},
			"path":     {Type: schema.String, Required: true, Desc: "File or directory path to remove"},
		}),
	}, func(ctx context.Context, input *RemoveInput) (string, error) {
		err := tc.Remove(ctx, tc.AssetEndpoint(input.AssetID), input.Path)
		if err != nil {
			return "", fmt.Errorf("failed to remove on %s: %w", getAssetName(tc, input.AssetID), err)
		}
		return fmt.Sprintf("Successfully removed %s on %s", input.Path, getAssetName(tc, input.AssetID)), nil
	})
}

// ---- Rename Tool ----

type RenameInput struct {
	AssetID string `json:"asset_id"`
	From    string `json:"from"`
	To      string `json:"to"`
}

func NewRenameTool(tc *tools.ToolContext) tool.InvokableTool {
	return utils.NewTool(&schema.ToolInfo{
		Name: "asset_fs_rename",
		Desc: "Rename or move a file/directory on a remote asset.",
		ParamsOneOf: schema.NewParamsOneOfByParams(map[string]*schema.ParameterInfo{
			"asset_id": {Type: schema.String, Required: true, Desc: "Asset ID of the remote server"},
			"from":     {Type: schema.String, Required: true, Desc: "Source path"},
			"to":       {Type: schema.String, Required: true, Desc: "Destination path"},
		}),
	}, func(ctx context.Context, input *RenameInput) (string, error) {
		err := tc.Rename(ctx, tc.AssetEndpoint(input.AssetID), input.From, input.To)
		if err != nil {
			return "", fmt.Errorf("failed to rename on %s: %w", getAssetName(tc, input.AssetID), err)
		}
		return fmt.Sprintf("Successfully renamed %s to %s on %s", input.From, input.To, getAssetName(tc, input.AssetID)), nil
	})
}

// ---- Copy Tool ----

type CopyInput struct {
	AssetID     string `json:"asset_id"`
	Source      string `json:"source"`
	Destination string `json:"destination"`
}

func NewCopyTool(tc *tools.ToolContext) tool.InvokableTool {
	return utils.NewTool(&schema.ToolInfo{
		Name: "asset_fs_copy",
		Desc: "Copy a file on a remote asset.",
		ParamsOneOf: schema.NewParamsOneOfByParams(map[string]*schema.ParameterInfo{
			"asset_id":    {Type: schema.String, Required: true, Desc: "Asset ID of the remote server"},
			"source":      {Type: schema.String, Required: true, Desc: "Source file path"},
			"destination": {Type: schema.String, Required: true, Desc: "Destination file path"},
		}),
	}, func(ctx context.Context, input *CopyInput) (string, error) {
		err := tc.Copy(ctx, tc.AssetEndpoint(input.AssetID), input.Source, input.Destination)
		if err != nil {
			return "", fmt.Errorf("failed to copy on %s: %w", getAssetName(tc, input.AssetID), err)
		}
		return fmt.Sprintf("Successfully copied %s to %s on %s", input.Source, input.Destination, getAssetName(tc, input.AssetID)), nil
	})
}
