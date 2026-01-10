// Package asset_exec provides command execution tools for remote asset operations.
package asset_exec

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/cloudwego/eino/components/tool"
	"github.com/cloudwego/eino/components/tool/utils"
	"github.com/cloudwego/eino/schema"
	"golang.org/x/crypto/ssh"

	"github.com/choraleia/choraleia/pkg/models"
	"github.com/choraleia/choraleia/pkg/tools"
)

func init() {
	tools.Register(tools.ToolDefinition{
		ID:          "asset_exec_command",
		Name:        "Execute Remote Command",
		Description: "Execute a shell command on a remote asset",
		Category:    tools.CategoryAsset,
		Scope:       tools.ScopeGlobal,
		Dangerous:   true,
	}, NewExecCommandTool)

	tools.Register(tools.ToolDefinition{
		ID:          "asset_exec_script",
		Name:        "Execute Remote Script",
		Description: "Execute a multi-line script on a remote asset",
		Category:    tools.CategoryAsset,
		Scope:       tools.ScopeGlobal,
		Dangerous:   true,
	}, NewExecScriptTool)

	tools.Register(tools.ToolDefinition{
		ID:          "asset_exec_batch",
		Name:        "Batch Execute",
		Description: "Execute the same command on multiple assets",
		Category:    tools.CategoryAsset,
		Scope:       tools.ScopeGlobal,
		Dangerous:   true,
	}, NewExecBatchTool)
}

// getAssetName retrieves the asset name for display
func getAssetName(tc *tools.ToolContext, assetID string) string {
	asset, err := tc.GetAsset(assetID)
	if err != nil {
		return assetID
	}
	return asset.Name
}

// executeOnAsset executes a command on a remote asset via SSH
func executeOnAsset(ctx context.Context, tc *tools.ToolContext, assetID, command string, timeout int) (string, int, error) {
	asset, err := tc.GetAsset(assetID)
	if err != nil {
		return "", -1, fmt.Errorf("asset not found: %s", assetID)
	}

	if asset.Type != models.AssetTypeSSH {
		return "", -1, fmt.Errorf("asset %s is not an SSH asset, cannot execute commands", asset.Name)
	}

	// Parse SSH config from asset.Config
	sshConfig, err := parseSSHConfig(asset.Config)
	if err != nil {
		return "", -1, fmt.Errorf("failed to parse SSH config: %w", err)
	}

	// Execute command via SSH
	output, exitCode, err := executeSSHCommand(ctx, sshConfig, command, timeout)
	if err != nil {
		return output, exitCode, err
	}

	return output, exitCode, nil
}

// parseSSHConfig converts asset.Config map to SSHConfig struct
func parseSSHConfig(config map[string]interface{}) (*models.SSHConfig, error) {
	data, err := json.Marshal(config)
	if err != nil {
		return nil, err
	}
	var sshConfig models.SSHConfig
	if err := json.Unmarshal(data, &sshConfig); err != nil {
		return nil, err
	}
	return &sshConfig, nil
}

// executeSSHCommand executes a command over SSH
func executeSSHCommand(ctx context.Context, config *models.SSHConfig, command string, timeout int) (string, int, error) {
	// Build SSH connection
	sshClient, err := connectSSH(config)
	if err != nil {
		return "", -1, fmt.Errorf("failed to connect: %w", err)
	}
	defer sshClient.Close()

	session, err := sshClient.NewSession()
	if err != nil {
		return "", -1, fmt.Errorf("failed to create session: %w", err)
	}
	defer session.Close()

	// Execute command
	output, err := session.CombinedOutput(command)
	exitCode := 0
	if err != nil {
		// Try to get exit status from SSH exit error
		if exitErr, ok := err.(*ssh.ExitError); ok {
			exitCode = exitErr.ExitStatus()
		} else {
			return string(output), -1, err
		}
	}

	return string(output), exitCode, nil
}

// ---- Execute Command Tool ----

type ExecCommandInput struct {
	AssetID        string `json:"asset_id"`
	Command        string `json:"command"`
	TimeoutSeconds int    `json:"timeout_seconds,omitempty"`
}

func NewExecCommandTool(tc *tools.ToolContext) tool.InvokableTool {
	return utils.NewTool(&schema.ToolInfo{
		Name: "asset_exec_command",
		Desc: "Execute a shell command on a remote asset (SSH server). Returns stdout, stderr and exit code. Use this for diagnostics, file operations, and running scripts on remote servers.",
		ParamsOneOf: schema.NewParamsOneOfByParams(map[string]*schema.ParameterInfo{
			"asset_id":        {Type: schema.String, Required: true, Desc: "Asset ID of the remote server"},
			"command":         {Type: schema.String, Required: true, Desc: "Command to execute"},
			"timeout_seconds": {Type: schema.Integer, Required: false, Desc: "Command timeout in seconds (default: 30)"},
		}),
	}, func(ctx context.Context, input *ExecCommandInput) (string, error) {
		timeout := input.TimeoutSeconds
		if timeout <= 0 {
			timeout = 30
		}

		output, exitCode, err := executeOnAsset(ctx, tc, input.AssetID, input.Command, timeout)

		var sb strings.Builder
		sb.WriteString(fmt.Sprintf("Asset: %s\n", getAssetName(tc, input.AssetID)))
		sb.WriteString(fmt.Sprintf("Command: %s\n", input.Command))

		if err != nil {
			sb.WriteString(fmt.Sprintf("Error: %v\n", err))
			if output != "" {
				sb.WriteString(fmt.Sprintf("\nOutput:\n%s", output))
			}
			return sb.String(), nil
		}

		sb.WriteString(fmt.Sprintf("Exit Code: %d\n", exitCode))
		if output != "" {
			sb.WriteString(fmt.Sprintf("\n--- Output ---\n%s", output))
		}

		return sb.String(), nil
	})
}

// ---- Execute Script Tool ----

type ExecScriptInput struct {
	AssetID        string `json:"asset_id"`
	Script         string `json:"script"`
	Shell          string `json:"shell,omitempty"`
	TimeoutSeconds int    `json:"timeout_seconds,omitempty"`
}

func NewExecScriptTool(tc *tools.ToolContext) tool.InvokableTool {
	return utils.NewTool(&schema.ToolInfo{
		Name: "asset_exec_script",
		Desc: "Execute a multi-line shell script on a remote asset. Useful for complex operations that require multiple commands.",
		ParamsOneOf: schema.NewParamsOneOfByParams(map[string]*schema.ParameterInfo{
			"asset_id":        {Type: schema.String, Required: true, Desc: "Asset ID of the remote server"},
			"script":          {Type: schema.String, Required: true, Desc: "Shell script content to execute"},
			"shell":           {Type: schema.String, Required: false, Desc: "Shell to use (default: /bin/sh)"},
			"timeout_seconds": {Type: schema.Integer, Required: false, Desc: "Script timeout in seconds (default: 60)"},
		}),
	}, func(ctx context.Context, input *ExecScriptInput) (string, error) {
		shell := input.Shell
		if shell == "" {
			shell = "/bin/sh"
		}

		timeout := input.TimeoutSeconds
		if timeout <= 0 {
			timeout = 60
		}

		// Wrap script in shell
		command := fmt.Sprintf("%s << 'SCRIPT_EOF'\n%s\nSCRIPT_EOF", shell, input.Script)

		output, exitCode, err := executeOnAsset(ctx, tc, input.AssetID, command, timeout)

		var sb strings.Builder
		sb.WriteString(fmt.Sprintf("Asset: %s\n", getAssetName(tc, input.AssetID)))
		sb.WriteString(fmt.Sprintf("Shell: %s\n", shell))

		if err != nil {
			sb.WriteString(fmt.Sprintf("Error: %v\n", err))
			if output != "" {
				sb.WriteString(fmt.Sprintf("\nOutput:\n%s", output))
			}
			return sb.String(), nil
		}

		sb.WriteString(fmt.Sprintf("Exit Code: %d\n", exitCode))
		if output != "" {
			sb.WriteString(fmt.Sprintf("\n--- Output ---\n%s", output))
		}

		return sb.String(), nil
	})
}

// ---- Batch Execute Tool ----

type ExecBatchInput struct {
	AssetIDs       []string `json:"asset_ids"`
	Command        string   `json:"command"`
	TimeoutSeconds int      `json:"timeout_seconds,omitempty"`
	StopOnError    bool     `json:"stop_on_error,omitempty"`
}

type BatchResult struct {
	AssetID   string `json:"asset_id"`
	AssetName string `json:"asset_name"`
	ExitCode  int    `json:"exit_code"`
	Output    string `json:"output"`
	Error     string `json:"error,omitempty"`
}

func NewExecBatchTool(tc *tools.ToolContext) tool.InvokableTool {
	return utils.NewTool(&schema.ToolInfo{
		Name: "asset_exec_batch",
		Desc: "Execute the same command on multiple remote assets. Useful for running diagnostics or updates across multiple servers.",
		ParamsOneOf: schema.NewParamsOneOfByParams(map[string]*schema.ParameterInfo{
			"asset_ids":       {Type: schema.Array, Required: true, Desc: "Array of asset IDs to execute on", ElemInfo: &schema.ParameterInfo{Type: schema.String}},
			"command":         {Type: schema.String, Required: true, Desc: "Command to execute on all assets"},
			"timeout_seconds": {Type: schema.Integer, Required: false, Desc: "Command timeout per asset in seconds (default: 30)"},
			"stop_on_error":   {Type: schema.Boolean, Required: false, Desc: "Stop execution if any asset fails (default: false)"},
		}),
	}, func(ctx context.Context, input *ExecBatchInput) (string, error) {
		timeout := input.TimeoutSeconds
		if timeout <= 0 {
			timeout = 30
		}

		results := make([]BatchResult, 0, len(input.AssetIDs))

		for _, assetID := range input.AssetIDs {
			result := BatchResult{
				AssetID:   assetID,
				AssetName: getAssetName(tc, assetID),
			}

			output, exitCode, err := executeOnAsset(ctx, tc, assetID, input.Command, timeout)
			result.Output = output
			result.ExitCode = exitCode

			if err != nil {
				result.Error = err.Error()
				result.ExitCode = -1
			}

			results = append(results, result)

			if input.StopOnError && (err != nil || exitCode != 0) {
				break
			}
		}

		// Format results
		data, _ := json.MarshalIndent(map[string]interface{}{
			"command":      input.Command,
			"total_assets": len(input.AssetIDs),
			"executed":     len(results),
			"results":      results,
		}, "", "  ")

		return string(data), nil
	})
}
