// Package workspace_exec provides command execution tools for workspace operations.
// Commands are executed in the workspace's runtime environment (local, local docker, or remote docker).
package workspace_exec

import (
	"context"
	"fmt"
	"strings"

	"github.com/cloudwego/eino/components/tool"
	"github.com/cloudwego/eino/components/tool/utils"
	"github.com/cloudwego/eino/schema"

	"github.com/choraleia/choraleia/pkg/tools"
)

func init() {
	tools.Register(tools.ToolDefinition{
		ID:          "workspace_exec_command",
		Name:        "Execute Command",
		Description: "Execute a shell command in the workspace runtime environment",
		Category:    tools.CategoryWorkspace,
		Scope:       tools.ScopeWorkspace,
		Dangerous:   true,
	}, NewExecCommandTool)

	tools.Register(tools.ToolDefinition{
		ID:          "workspace_exec_script",
		Name:        "Execute Script",
		Description: "Execute a multi-line script in the workspace runtime environment",
		Category:    tools.CategoryWorkspace,
		Scope:       tools.ScopeWorkspace,
		Dangerous:   true,
	}, NewExecScriptTool)
}

// ---- Execute Command Tool ----

type ExecCommandInput struct {
	Command string   `json:"command"`
	Args    []string `json:"args,omitempty"`
}

func NewExecCommandTool(tc *tools.ToolContext) tool.InvokableTool {
	return utils.NewTool(&schema.ToolInfo{
		Name: "workspace_exec_command",
		Desc: "Execute a shell command in the workspace runtime environment (local, docker container, or remote docker). The command runs in the workspace's configured runtime.",
		ParamsOneOf: schema.NewParamsOneOfByParams(map[string]*schema.ParameterInfo{
			"command": {Type: schema.String, Required: true, Desc: "Command to execute (e.g., 'ls', 'cat', 'grep')"},
			"args":    {Type: schema.Array, Required: false, Desc: "Command arguments as array", ElemInfo: &schema.ParameterInfo{Type: schema.String}},
		}),
	}, func(ctx context.Context, input *ExecCommandInput) (string, error) {
		// Build command array
		cmd := []string{input.Command}
		cmd = append(cmd, input.Args...)

		// Execute in workspace runtime
		output, err := tc.ExecInWorkspace(ctx, cmd)
		if err != nil {
			return "", fmt.Errorf("failed to execute command: %w", err)
		}

		var sb strings.Builder
		sb.WriteString(fmt.Sprintf("Command: %s %s\n", input.Command, strings.Join(input.Args, " ")))
		sb.WriteString(fmt.Sprintf("\n--- Output ---\n%s", output))

		return sb.String(), nil
	})
}

// ---- Execute Script Tool ----

type ExecScriptInput struct {
	Script string `json:"script"`
	Shell  string `json:"shell,omitempty"`
}

func NewExecScriptTool(tc *tools.ToolContext) tool.InvokableTool {
	return utils.NewTool(&schema.ToolInfo{
		Name: "workspace_exec_script",
		Desc: "Execute a multi-line shell script in the workspace runtime environment. The script runs in the workspace's configured runtime (local, docker container, or remote docker).",
		ParamsOneOf: schema.NewParamsOneOfByParams(map[string]*schema.ParameterInfo{
			"script": {Type: schema.String, Required: true, Desc: "Shell script content to execute"},
			"shell":  {Type: schema.String, Required: false, Desc: "Shell to use (default: /bin/sh)"},
		}),
	}, func(ctx context.Context, input *ExecScriptInput) (string, error) {
		shell := input.Shell
		if shell == "" {
			shell = "/bin/sh"
		}

		// Execute script via shell -c
		cmd := []string{shell, "-c", input.Script}

		output, err := tc.ExecInWorkspace(ctx, cmd)
		if err != nil {
			return "", fmt.Errorf("failed to execute script: %w", err)
		}

		var sb strings.Builder
		sb.WriteString(fmt.Sprintf("Shell: %s\n", shell))
		sb.WriteString(fmt.Sprintf("\n--- Output ---\n%s", output))

		return sb.String(), nil
	})
}
