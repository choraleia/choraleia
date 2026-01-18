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
	workDir := tc.GetWorkspaceWorkDir()
	desc := "List directory contents in the workspace. Returns file names, sizes, and types."
	if workDir != "" {
		desc += fmt.Sprintf(" Working directory: %s. Relative paths are resolved from this directory.", workDir)
	}

	return utils.NewTool(&schema.ToolInfo{
		Name: "workspace_fs_list",
		Desc: desc,
		ParamsOneOf: schema.NewParamsOneOfByParams(map[string]*schema.ParameterInfo{
			"path": {Type: schema.String, Required: true, Desc: "Directory path to list (relative to working directory or absolute)"},
			"all":  {Type: schema.Boolean, Required: false, Desc: "Include hidden files (default: false)"},
		}),
	}, func(ctx context.Context, input *ListInput) (string, error) {
		resolvedPath := tc.ResolvePath(input.Path)
		result, err := tc.ListDir(ctx, tc.WorkspaceEndpoint(), resolvedPath, input.All)
		if err != nil {
			return "", fmt.Errorf("failed to list directory: %w", err)
		}

		// Format output
		var sb strings.Builder
		sb.WriteString(fmt.Sprintf("Directory: %s\n", resolvedPath))
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
	Path      string `json:"path"`
	StartLine *int   `json:"start_line,omitempty"` // 1-based start line number
	EndLine   *int   `json:"end_line,omitempty"`   // 1-based end line number (inclusive)
	MaxBytes  *int   `json:"max_bytes,omitempty"`
}

func NewReadTool(tc *tools.ToolContext) tool.InvokableTool {
	workDir := tc.GetWorkspaceWorkDir()
	desc := `Read the content of a file in the workspace. Use for viewing configuration files, logs, or source code.
Supports reading specific line ranges for efficient reading of large files.`
	if workDir != "" {
		desc += fmt.Sprintf("\nWorking directory: %s. Relative paths are resolved from this directory.", workDir)
	}

	return utils.NewTool(&schema.ToolInfo{
		Name: "workspace_fs_read",
		Desc: desc,
		ParamsOneOf: schema.NewParamsOneOfByParams(map[string]*schema.ParameterInfo{
			"path":       {Type: schema.String, Required: true, Desc: "File path to read (relative to working directory or absolute)"},
			"start_line": {Type: schema.Integer, Required: false, Desc: "Start line number (1-based, inclusive). If omitted, starts from beginning."},
			"end_line":   {Type: schema.Integer, Required: false, Desc: "End line number (1-based, inclusive). If omitted, reads to end."},
			"max_bytes":  {Type: schema.Integer, Required: false, Desc: "Maximum bytes to read (default: no limit)"},
		}),
	}, func(ctx context.Context, input *ReadInput) (string, error) {
		resolvedPath := tc.ResolvePath(input.Path)
		content, err := tc.ReadFile(ctx, tc.WorkspaceEndpoint(), resolvedPath)
		if err != nil {
			return "", fmt.Errorf("failed to read file: %w", err)
		}

		// Handle line range if specified
		if input.StartLine != nil || input.EndLine != nil {
			lines := strings.Split(content, "\n")
			totalLines := len(lines)

			startIdx := 0
			endIdx := totalLines

			if input.StartLine != nil {
				startIdx = *input.StartLine - 1 // Convert to 0-based
				if startIdx < 0 {
					startIdx = 0
				}
				if startIdx > totalLines {
					startIdx = totalLines
				}
			}

			if input.EndLine != nil {
				endIdx = *input.EndLine // End is inclusive, so no -1
				if endIdx < 0 {
					endIdx = 0
				}
				if endIdx > totalLines {
					endIdx = totalLines
				}
			}

			if startIdx > endIdx {
				startIdx = endIdx
			}

			// Build result with line numbers
			var sb strings.Builder
			if startIdx > 0 {
				sb.WriteString(fmt.Sprintf("... (lines 1-%d omitted)\n", startIdx))
			}

			for i := startIdx; i < endIdx; i++ {
				sb.WriteString(fmt.Sprintf("%4d | %s\n", i+1, lines[i]))
			}

			if endIdx < totalLines {
				sb.WriteString(fmt.Sprintf("... (lines %d-%d omitted)\n", endIdx+1, totalLines))
			}

			content = sb.String()
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
	workDir := tc.GetWorkspaceWorkDir()
	desc := "Write content to a file in the workspace. Creates the file if it doesn't exist."
	if workDir != "" {
		desc += fmt.Sprintf(" Working directory: %s. Relative paths are resolved from this directory.", workDir)
	}

	return utils.NewTool(&schema.ToolInfo{
		Name: "workspace_fs_write",
		Desc: desc,
		ParamsOneOf: schema.NewParamsOneOfByParams(map[string]*schema.ParameterInfo{
			"path":      {Type: schema.String, Required: true, Desc: "File path to write (relative to working directory or absolute)"},
			"content":   {Type: schema.String, Required: true, Desc: "Content to write"},
			"overwrite": {Type: schema.Boolean, Required: false, Desc: "Overwrite existing file (default: true)"},
		}),
	}, func(ctx context.Context, input *WriteInput) (string, error) {
		resolvedPath := tc.ResolvePath(input.Path)
		err := tc.WriteFile(ctx, tc.WorkspaceEndpoint(), resolvedPath, input.Content)
		if err != nil {
			return "", fmt.Errorf("failed to write file: %w", err)
		}

		return fmt.Sprintf("Successfully wrote %d bytes to %s", len(input.Content), resolvedPath), nil
	})
}

// ---- Stat Tool ----

type StatInput struct {
	Path string `json:"path"`
}

func NewStatTool(tc *tools.ToolContext) tool.InvokableTool {
	workDir := tc.GetWorkspaceWorkDir()
	desc := "Get detailed information about a file or directory in the workspace."
	if workDir != "" {
		desc += fmt.Sprintf(" Working directory: %s.", workDir)
	}

	return utils.NewTool(&schema.ToolInfo{
		Name: "workspace_fs_stat",
		Desc: desc,
		ParamsOneOf: schema.NewParamsOneOfByParams(map[string]*schema.ParameterInfo{
			"path": {Type: schema.String, Required: true, Desc: "File or directory path (relative to working directory or absolute)"},
		}),
	}, func(ctx context.Context, input *StatInput) (string, error) {
		resolvedPath := tc.ResolvePath(input.Path)
		info, err := tc.Stat(ctx, tc.WorkspaceEndpoint(), resolvedPath)
		if err != nil {
			return "", fmt.Errorf("failed to get file info: %w", err)
		}

		result := map[string]interface{}{
			"name":     info.Name,
			"path":     resolvedPath,
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
	workDir := tc.GetWorkspaceWorkDir()
	desc := "Create a directory in the workspace. Creates parent directories if needed."
	if workDir != "" {
		desc += fmt.Sprintf(" Working directory: %s.", workDir)
	}

	return utils.NewTool(&schema.ToolInfo{
		Name: "workspace_fs_mkdir",
		Desc: desc,
		ParamsOneOf: schema.NewParamsOneOfByParams(map[string]*schema.ParameterInfo{
			"path": {Type: schema.String, Required: true, Desc: "Directory path to create (relative to working directory or absolute)"},
		}),
	}, func(ctx context.Context, input *MkdirInput) (string, error) {
		resolvedPath := tc.ResolvePath(input.Path)
		err := tc.Mkdir(ctx, tc.WorkspaceEndpoint(), resolvedPath)
		if err != nil {
			return "", fmt.Errorf("failed to create directory: %w", err)
		}
		return fmt.Sprintf("Successfully created directory: %s", resolvedPath), nil
	})
}

// ---- Remove Tool ----

type RemoveInput struct {
	Path string `json:"path"`
}

func NewRemoveTool(tc *tools.ToolContext) tool.InvokableTool {
	workDir := tc.GetWorkspaceWorkDir()
	desc := "Remove a file or directory in the workspace. Use with caution."
	if workDir != "" {
		desc += fmt.Sprintf(" Working directory: %s.", workDir)
	}

	return utils.NewTool(&schema.ToolInfo{
		Name: "workspace_fs_remove",
		Desc: desc,
		ParamsOneOf: schema.NewParamsOneOfByParams(map[string]*schema.ParameterInfo{
			"path": {Type: schema.String, Required: true, Desc: "File or directory path to remove (relative to working directory or absolute)"},
		}),
	}, func(ctx context.Context, input *RemoveInput) (string, error) {
		resolvedPath := tc.ResolvePath(input.Path)
		err := tc.Remove(ctx, tc.WorkspaceEndpoint(), resolvedPath)
		if err != nil {
			return "", fmt.Errorf("failed to remove: %w", err)
		}
		return fmt.Sprintf("Successfully removed: %s", resolvedPath), nil
	})
}

// ---- Rename Tool ----

type RenameInput struct {
	From string `json:"from"`
	To   string `json:"to"`
}

func NewRenameTool(tc *tools.ToolContext) tool.InvokableTool {
	workDir := tc.GetWorkspaceWorkDir()
	desc := "Rename or move a file/directory in the workspace."
	if workDir != "" {
		desc += fmt.Sprintf(" Working directory: %s.", workDir)
	}

	return utils.NewTool(&schema.ToolInfo{
		Name: "workspace_fs_rename",
		Desc: desc,
		ParamsOneOf: schema.NewParamsOneOfByParams(map[string]*schema.ParameterInfo{
			"from": {Type: schema.String, Required: true, Desc: "Source path (relative to working directory or absolute)"},
			"to":   {Type: schema.String, Required: true, Desc: "Destination path (relative to working directory or absolute)"},
		}),
	}, func(ctx context.Context, input *RenameInput) (string, error) {
		resolvedFrom := tc.ResolvePath(input.From)
		resolvedTo := tc.ResolvePath(input.To)
		err := tc.Rename(ctx, tc.WorkspaceEndpoint(), resolvedFrom, resolvedTo)
		if err != nil {
			return "", fmt.Errorf("failed to rename: %w", err)
		}
		return fmt.Sprintf("Successfully renamed %s to %s", resolvedFrom, resolvedTo), nil
	})
}

// ---- Copy Tool ----

type CopyInput struct {
	Source      string `json:"source"`
	Destination string `json:"destination"`
}

func NewCopyTool(tc *tools.ToolContext) tool.InvokableTool {
	workDir := tc.GetWorkspaceWorkDir()
	desc := "Copy a file in the workspace."
	if workDir != "" {
		desc += fmt.Sprintf(" Working directory: %s.", workDir)
	}

	return utils.NewTool(&schema.ToolInfo{
		Name: "workspace_fs_copy",
		Desc: desc,
		ParamsOneOf: schema.NewParamsOneOfByParams(map[string]*schema.ParameterInfo{
			"source":      {Type: schema.String, Required: true, Desc: "Source file path (relative to working directory or absolute)"},
			"destination": {Type: schema.String, Required: true, Desc: "Destination file path (relative to working directory or absolute)"},
		}),
	}, func(ctx context.Context, input *CopyInput) (string, error) {
		resolvedSrc := tc.ResolvePath(input.Source)
		resolvedDst := tc.ResolvePath(input.Destination)
		err := tc.Copy(ctx, tc.WorkspaceEndpoint(), resolvedSrc, resolvedDst)
		if err != nil {
			return "", fmt.Errorf("failed to copy: %w", err)
		}
		return fmt.Sprintf("Successfully copied %s to %s", resolvedSrc, resolvedDst), nil
	})
}
