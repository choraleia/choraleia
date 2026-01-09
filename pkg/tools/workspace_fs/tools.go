// Package workspace_fs provides file system tools for workspace (local) operations.
package workspace_fs

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
	// Register all workspace file system tools
	tools.Register(tools.ToolDefinition{
		ID:          "workspace_fs_list",
		Name:        "List Directory",
		Description: "List directory contents in the workspace",
		Category:    tools.CategoryWorkspace,
		Scope:       tools.ScopeWorkspace,
		Dangerous:   false,
	}, NewListTool)

	tools.Register(tools.ToolDefinition{
		ID:          "workspace_fs_read",
		Name:        "Read File",
		Description: "Read file content in the workspace",
		Category:    tools.CategoryWorkspace,
		Scope:       tools.ScopeWorkspace,
		Dangerous:   false,
	}, NewReadTool)

	tools.Register(tools.ToolDefinition{
		ID:          "workspace_fs_write",
		Name:        "Write File",
		Description: "Write content to a file in the workspace",
		Category:    tools.CategoryWorkspace,
		Scope:       tools.ScopeWorkspace,
		Dangerous:   true,
	}, NewWriteTool)

	tools.Register(tools.ToolDefinition{
		ID:          "workspace_fs_stat",
		Name:        "File Info",
		Description: "Get file or directory information in the workspace",
		Category:    tools.CategoryWorkspace,
		Scope:       tools.ScopeWorkspace,
		Dangerous:   false,
	}, NewStatTool)

	tools.Register(tools.ToolDefinition{
		ID:          "workspace_fs_mkdir",
		Name:        "Create Directory",
		Description: "Create a directory in the workspace",
		Category:    tools.CategoryWorkspace,
		Scope:       tools.ScopeWorkspace,
		Dangerous:   true,
	}, NewMkdirTool)

	tools.Register(tools.ToolDefinition{
		ID:          "workspace_fs_remove",
		Name:        "Remove File/Directory",
		Description: "Remove a file or directory in the workspace",
		Category:    tools.CategoryWorkspace,
		Scope:       tools.ScopeWorkspace,
		Dangerous:   true,
	}, NewRemoveTool)

	tools.Register(tools.ToolDefinition{
		ID:          "workspace_fs_rename",
		Name:        "Rename/Move",
		Description: "Rename or move a file/directory in the workspace",
		Category:    tools.CategoryWorkspace,
		Scope:       tools.ScopeWorkspace,
		Dangerous:   true,
	}, NewRenameTool)

	tools.Register(tools.ToolDefinition{
		ID:          "workspace_fs_copy",
		Name:        "Copy File",
		Description: "Copy a file in the workspace",
		Category:    tools.CategoryWorkspace,
		Scope:       tools.ScopeWorkspace,
		Dangerous:   true,
	}, NewCopyTool)
}

// ---- List Directory Tool ----

type ListInput struct {
	Path string `json:"path"`
	All  bool   `json:"all,omitempty"`
}

func NewListTool(tc *tools.ToolContext) tool.InvokableTool {
	return utils.NewTool(&schema.ToolInfo{
		Name: "workspace_fs_list",
		Desc: "List directory contents in the workspace (local filesystem). Returns file names, sizes, and types.",
		ParamsOneOf: schema.NewParamsOneOfByParams(map[string]*schema.ParameterInfo{
			"path": {Type: schema.String, Required: true, Desc: "Directory path to list"},
			"all":  {Type: schema.Boolean, Required: false, Desc: "Include hidden files (default: false)"},
		}),
	}, func(ctx context.Context, input *ListInput) (string, error) {
		result, err := tc.ListDir(ctx, tc.WorkspaceEndpoint(), input.Path, input.All)
		if err != nil {
			return "", fmt.Errorf("failed to list directory: %w", err)
		}

		// Format output
		var sb strings.Builder
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
	Path     string `json:"path"`
	MaxBytes *int   `json:"max_bytes,omitempty"`
}

func NewReadTool(tc *tools.ToolContext) tool.InvokableTool {
	return utils.NewTool(&schema.ToolInfo{
		Name: "workspace_fs_read",
		Desc: "Read the content of a file in the workspace. Use for viewing configuration files, logs, or source code.",
		ParamsOneOf: schema.NewParamsOneOfByParams(map[string]*schema.ParameterInfo{
			"path":      {Type: schema.String, Required: true, Desc: "File path to read"},
			"max_bytes": {Type: schema.Integer, Required: false, Desc: "Maximum bytes to read (default: no limit)"},
		}),
	}, func(ctx context.Context, input *ReadInput) (string, error) {
		content, err := tc.ReadFile(ctx, tc.WorkspaceEndpoint(), input.Path)
		if err != nil {
			return "", fmt.Errorf("failed to read file: %w", err)
		}

		if input.MaxBytes != nil && len(content) > *input.MaxBytes {
			content = content[:*input.MaxBytes] + "\n...[truncated]"
		}

		return content, nil
	})
}

// ---- Write File Tool ----

type WriteInput struct {
	Path      string `json:"path"`
	Content   string `json:"content"`
	Overwrite bool   `json:"overwrite,omitempty"`
}

func NewWriteTool(tc *tools.ToolContext) tool.InvokableTool {
	return utils.NewTool(&schema.ToolInfo{
		Name: "workspace_fs_write",
		Desc: "Write content to a file in the workspace. Creates the file if it doesn't exist.",
		ParamsOneOf: schema.NewParamsOneOfByParams(map[string]*schema.ParameterInfo{
			"path":      {Type: schema.String, Required: true, Desc: "File path to write"},
			"content":   {Type: schema.String, Required: true, Desc: "Content to write"},
			"overwrite": {Type: schema.Boolean, Required: false, Desc: "Overwrite existing file (default: true)"},
		}),
	}, func(ctx context.Context, input *WriteInput) (string, error) {
		err := tc.WriteFile(ctx, tc.WorkspaceEndpoint(), input.Path, input.Content)
		if err != nil {
			return "", fmt.Errorf("failed to write file: %w", err)
		}

		return fmt.Sprintf("Successfully wrote %d bytes to %s", len(input.Content), input.Path), nil
	})
}

// ---- Stat Tool ----

type StatInput struct {
	Path string `json:"path"`
}

func NewStatTool(tc *tools.ToolContext) tool.InvokableTool {
	return utils.NewTool(&schema.ToolInfo{
		Name: "workspace_fs_stat",
		Desc: "Get detailed information about a file or directory in the workspace.",
		ParamsOneOf: schema.NewParamsOneOfByParams(map[string]*schema.ParameterInfo{
			"path": {Type: schema.String, Required: true, Desc: "File or directory path"},
		}),
	}, func(ctx context.Context, input *StatInput) (string, error) {
		info, err := tc.Stat(ctx, tc.WorkspaceEndpoint(), input.Path)
		if err != nil {
			return "", fmt.Errorf("failed to get file info: %w", err)
		}

		result := map[string]interface{}{
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
	Path string `json:"path"`
}

func NewMkdirTool(tc *tools.ToolContext) tool.InvokableTool {
	return utils.NewTool(&schema.ToolInfo{
		Name: "workspace_fs_mkdir",
		Desc: "Create a directory in the workspace. Creates parent directories if needed.",
		ParamsOneOf: schema.NewParamsOneOfByParams(map[string]*schema.ParameterInfo{
			"path": {Type: schema.String, Required: true, Desc: "Directory path to create"},
		}),
	}, func(ctx context.Context, input *MkdirInput) (string, error) {
		err := tc.Mkdir(ctx, tc.WorkspaceEndpoint(), input.Path)
		if err != nil {
			return "", fmt.Errorf("failed to create directory: %w", err)
		}
		return fmt.Sprintf("Successfully created directory: %s", input.Path), nil
	})
}

// ---- Remove Tool ----

type RemoveInput struct {
	Path string `json:"path"`
}

func NewRemoveTool(tc *tools.ToolContext) tool.InvokableTool {
	return utils.NewTool(&schema.ToolInfo{
		Name: "workspace_fs_remove",
		Desc: "Remove a file or directory in the workspace. Use with caution.",
		ParamsOneOf: schema.NewParamsOneOfByParams(map[string]*schema.ParameterInfo{
			"path": {Type: schema.String, Required: true, Desc: "File or directory path to remove"},
		}),
	}, func(ctx context.Context, input *RemoveInput) (string, error) {
		err := tc.Remove(ctx, tc.WorkspaceEndpoint(), input.Path)
		if err != nil {
			return "", fmt.Errorf("failed to remove: %w", err)
		}
		return fmt.Sprintf("Successfully removed: %s", input.Path), nil
	})
}

// ---- Rename Tool ----

type RenameInput struct {
	From string `json:"from"`
	To   string `json:"to"`
}

func NewRenameTool(tc *tools.ToolContext) tool.InvokableTool {
	return utils.NewTool(&schema.ToolInfo{
		Name: "workspace_fs_rename",
		Desc: "Rename or move a file/directory in the workspace.",
		ParamsOneOf: schema.NewParamsOneOfByParams(map[string]*schema.ParameterInfo{
			"from": {Type: schema.String, Required: true, Desc: "Source path"},
			"to":   {Type: schema.String, Required: true, Desc: "Destination path"},
		}),
	}, func(ctx context.Context, input *RenameInput) (string, error) {
		err := tc.Rename(ctx, tc.WorkspaceEndpoint(), input.From, input.To)
		if err != nil {
			return "", fmt.Errorf("failed to rename: %w", err)
		}
		return fmt.Sprintf("Successfully renamed %s to %s", input.From, input.To), nil
	})
}

// ---- Copy Tool ----

type CopyInput struct {
	Source      string `json:"source"`
	Destination string `json:"destination"`
}

func NewCopyTool(tc *tools.ToolContext) tool.InvokableTool {
	return utils.NewTool(&schema.ToolInfo{
		Name: "workspace_fs_copy",
		Desc: "Copy a file in the workspace.",
		ParamsOneOf: schema.NewParamsOneOfByParams(map[string]*schema.ParameterInfo{
			"source":      {Type: schema.String, Required: true, Desc: "Source file path"},
			"destination": {Type: schema.String, Required: true, Desc: "Destination file path"},
		}),
	}, func(ctx context.Context, input *CopyInput) (string, error) {
		err := tc.Copy(ctx, tc.WorkspaceEndpoint(), input.Source, input.Destination)
		if err != nil {
			return "", fmt.Errorf("failed to copy: %w", err)
		}
		return fmt.Sprintf("Successfully copied %s to %s", input.Source, input.Destination), nil
	})
}
