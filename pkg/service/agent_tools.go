package service

import (
	"context"
	"fmt"
	"regexp"
	"strings"
	"time"

	"github.com/cloudwego/eino/components/tool"
	"github.com/cloudwego/eino/components/tool/utils"
	"github.com/cloudwego/eino/schema"
	"github.com/google/uuid"
)

// Tool input structs

type TerminalOutputInput struct {
	TerminalId string `json:"terminal_id"`
	Lines      int    `json:"lines"`
}

type ExecCommandInput struct {
	TerminalId     string `json:"terminal_id"`
	Command        string `json:"command"`
	TimeoutSeconds int    `json:"timeout_seconds"`
}

type ReadFileInput struct {
	TerminalId string `json:"terminal_id"`
	Path       string `json:"path"`
	MaxBytes   int    `json:"max_bytes"`
}

type WriteFileInput struct {
	TerminalId string `json:"terminal_id"`
	Path       string `json:"path"`
	Content    string `json:"content"`
	Overwrite  bool   `json:"overwrite"`
}

// Tool implementations

func GetTerminalOutput(_ context.Context, params *TerminalOutputInput) (string, error) {
	output, err := GlobalTerminalManager.RequestTerminalOutput(params.TerminalId, params.Lines)
	if err != nil {
		GlobalTerminalManager.logger.Error("Failed to request terminal output via websocket", "error", err, "terminalId", params.TerminalId)
		return "", fmt.Errorf("failed to get terminal output: %w", err)
	}
	if len(output) == 0 {
		return "Terminal output is empty", nil
	}
	result := strings.Join(output, "\n")
	return result, nil
}

func ExecTerminalCommand(_ context.Context, params *ExecCommandInput) (string, error) {
	if params.TerminalId == "" || params.Command == "" {
		return "", fmt.Errorf("terminal_id and command are required")
	}
	if params.TimeoutSeconds <= 0 {
		params.TimeoutSeconds = 30
	}
	GlobalTerminalManager.mutex.RLock()
	session, exists := GlobalTerminalManager.terminals[params.TerminalId]
	GlobalTerminalManager.mutex.RUnlock()
	if !exists || session.term == nil {
		return "", fmt.Errorf("terminal not ready: %s", params.TerminalId)
	}
	session.mutex.RLock()
	startLen := len(session.Output)
	session.mutex.RUnlock()

	marker := "__OMNITERM_EXIT_CODE__"
	augmentedCmd := fmt.Sprintf("%s; echo %s$?", params.Command, marker)

	session.term.writeToTerminal([]byte(augmentedCmd + "\n"))

	deadline := time.Now().Add(time.Duration(params.TimeoutSeconds) * time.Second)
	exitCode := -1
	exitCodeRegex := regexp.MustCompile(marker + `([0-9]+)`)

	for time.Now().Before(deadline) {
		session.mutex.RLock()
		currentLen := len(session.Output)
		var newData string
		if currentLen > startLen {
			var b strings.Builder
			for _, chunk := range session.Output[startLen:] {
				b.WriteString(chunk)
			}
			newData = b.String()
		}
		session.mutex.RUnlock()
		if newData != "" {
			if m := exitCodeRegex.FindStringSubmatch(newData); len(m) == 2 {
				_, _ = fmt.Sscanf(m[1], "%d", &exitCode)
				break
			}
		}
		time.Sleep(200 * time.Millisecond)
	}

	session.mutex.RLock()
	var b strings.Builder
	for _, chunk := range session.Output[startLen:] {
		b.WriteString(chunk)
	}
	allOutput := b.String()
	session.mutex.RUnlock()

	if exitCode == -1 {
		if m := exitCodeRegex.FindStringSubmatch(allOutput); len(m) == 2 {
			_, _ = fmt.Sscanf(m[1], "%d", &exitCode)
		}
	}
	allOutput = strings.ReplaceAll(allOutput, marker, "")

	if exitCode == -1 {
		if session.term != nil {
			session.term.writeToTerminal([]byte("\x03"))
			time.Sleep(3 * time.Millisecond)
			session.mutex.RLock()
			var b2 strings.Builder
			for _, chunk := range session.Output[startLen:] {
				b2.WriteString(chunk)
			}
			allOutput = b2.String()
			allOutput = strings.ReplaceAll(allOutput, marker, "")
			session.mutex.RUnlock()
			return fmt.Sprintf("Command timed out, attempted interrupt (Ctrl+C).\nCommand: %s\nOutput:\n%s", params.Command, allOutput), nil
		}
		return fmt.Sprintf("Command executed but exit code not detected (possibly timeout).\nCommand: %s\nOutput:\n%s", params.Command, allOutput), nil
	}

	return fmt.Sprintf("Command completed\nCommand: %s\nExit Code: %d\nOutput:\n%s", params.Command, exitCode, allOutput), nil
}

func ReadFile(_ context.Context, params *ReadFileInput) (string, error) {
	if params.TerminalId == "" || params.Path == "" {
		return "", fmt.Errorf("terminal_id and path are required")
	}
	GlobalTerminalManager.mutex.RLock()
	session, exists := GlobalTerminalManager.terminals[params.TerminalId]
	GlobalTerminalManager.mutex.RUnlock()
	if !exists || session.term == nil {
		return "", fmt.Errorf("terminal not ready: %s", params.TerminalId)
	}
	if params.MaxBytes <= 0 || params.MaxBytes > 200000 {
		params.MaxBytes = 200000
	}
	marker := "__OMNITERM_EXIT_CODE__"
	cmd := fmt.Sprintf("cat -- %s; echo %s$?", params.Path, marker)
	session.mutex.RLock()
	startLen := len(session.Output)
	session.mutex.RUnlock()
	session.term.writeToTerminal([]byte(cmd + "\n"))
	deadline := time.Now().Add(15 * time.Second)
	exitCode := -1
	exitCodeRegex := regexp.MustCompile(marker + `([0-9]+)`)
	var collected string
	for time.Now().Before(deadline) {
		session.mutex.RLock()
		if len(session.Output) > startLen {
			var b strings.Builder
			for _, chunk := range session.Output[startLen:] {
				b.WriteString(chunk)
			}
			collected = b.String()
		}
		session.mutex.RUnlock()
		if collected != "" {
			if m := exitCodeRegex.FindStringSubmatch(collected); len(m) == 2 {
				_, _ = fmt.Sscanf(m[1], "%d", &exitCode)
				break
			}
		}
		time.Sleep(150 * time.Millisecond)
	}
	if exitCode == -1 {
		if m := exitCodeRegex.FindStringSubmatch(collected); len(m) == 2 {
			_, _ = fmt.Sscanf(m[1], "%d", &exitCode)
		}
	}
	content := strings.ReplaceAll(collected, marker, "")
	if exitCode != 0 {
		return fmt.Sprintf("Failed to read file (exit code %d)\nOutput:\n%s", exitCode, content), nil
	}
	if len(content) > params.MaxBytes {
		content = content[:params.MaxBytes] + "\n...[truncated]"
	}
	return content, nil
}

func WriteFile(_ context.Context, params *WriteFileInput) (string, error) {
	if params.TerminalId == "" || params.Path == "" {
		return "", fmt.Errorf("terminal_id and path are required")
	}
	GlobalTerminalManager.mutex.RLock()
	session, exists := GlobalTerminalManager.terminals[params.TerminalId]
	GlobalTerminalManager.mutex.RUnlock()
	if !exists || session.term == nil {
		return "", fmt.Errorf("terminal not ready: %s", params.TerminalId)
	}
	delimiter := "OMNI_EOF"
	if strings.Contains(params.Content, delimiter) {
		delimiter = "OMNI_EOF_" + uuid.New().String()
	}
	redir := ">"
	if !params.Overwrite {
		redir = ">>"
	}
	marker := "__OMNITERM_EXIT_CODE__"
	cmd := fmt.Sprintf("cat <<'%s' %s %s\n%s\n%s\necho %s$?", delimiter, redir, params.Path, params.Content, delimiter, marker)
	session.mutex.RLock()
	startLen := len(session.Output)
	session.mutex.RUnlock()
	session.term.writeToTerminal([]byte(cmd + "\n"))
	deadline := time.Now().Add(20 * time.Second)
	exitCode := -1
	exitCodeRegex := regexp.MustCompile(marker + `([0-9]+)`)
	var collected string
	for time.Now().Before(deadline) {
		session.mutex.RLock()
		if len(session.Output) > startLen {
			var b strings.Builder
			for _, chunk := range session.Output[startLen:] {
				b.WriteString(chunk)
			}
			collected = b.String()
		}
		session.mutex.RUnlock()
		if collected != "" {
			if m := exitCodeRegex.FindStringSubmatch(collected); len(m) == 2 {
				_, _ = fmt.Sscanf(m[1], "%d", &exitCode)
				break
			}
		}
		time.Sleep(150 * time.Millisecond)
	}
	if exitCode == -1 {
		if m := exitCodeRegex.FindStringSubmatch(collected); len(m) == 2 {
			_, _ = fmt.Sscanf(m[1], "%d", &exitCode)
		}
	}
	collected = strings.ReplaceAll(collected, marker, "")
	mode := "overwrite"
	if !params.Overwrite {
		mode = "append"
	}
	if exitCode != 0 {
		return fmt.Sprintf("Failed to write file (exit code %d)\nMode: %s Path: %s\nOutput:\n%s", exitCode, mode, params.Path, collected), nil
	}
	return fmt.Sprintf("File write succeeded. Mode: %s Path: %s Bytes: %d", mode, params.Path, len(params.Content)), nil
}

// Tool constructors

func NewTerminalOutputTool() tool.InvokableTool {
	terminalTool := utils.NewTool(&schema.ToolInfo{
		Name:  "terminal_get_output",
		Desc:  "Fetch recent output of a specified terminal; choose a terminal_id from IDs mentioned in user messages.",
		Extra: map[string]any{},
		ParamsOneOf: schema.NewParamsOneOfByParams(map[string]*schema.ParameterInfo{
			"terminal_id": {Type: schema.String, Required: true, Desc: "Terminal ID to inspect. Use explicit IDs mentioned by user (e.g. from 'Current Terminal ID' or 'Available Terminal List'), avoid literal placeholders like 'currentTerminal'."},
			"lines":       {Type: schema.Integer, Required: true, Desc: "Number of latest lines to fetch. Default 100."},
		}),
	}, GetTerminalOutput)
	return terminalTool
}

func NewExecCommandTool() tool.InvokableTool {
	cmdTool := utils.NewTool(&schema.ToolInfo{
		Name:  "terminal_exec_command",
		Desc:  "Execute a shell command in a terminal and return exit code & output. Use for diagnosis, file inspection, running scripts.",
		Extra: map[string]any{},
		ParamsOneOf: schema.NewParamsOneOfByParams(map[string]*schema.ParameterInfo{
			"terminal_id":     {Type: schema.String, Required: true, Desc: "Target terminal ID from context."},
			"command":         {Type: schema.String, Required: true, Desc: "Shell command to execute (no newline)."},
			"timeout_seconds": {Type: schema.Integer, Required: false, Desc: "Timeout waiting for command output (seconds), default 30"},
		}),
	}, ExecTerminalCommand)
	return cmdTool
}

func NewReadFileTool() tool.InvokableTool {
	readTool := utils.NewTool(&schema.ToolInfo{
		Name:  "terminal_read_file",
		Desc:  "Read the content of a file using cat. Provide a valid terminal_id and file path.",
		Extra: map[string]any{},
		ParamsOneOf: schema.NewParamsOneOfByParams(map[string]*schema.ParameterInfo{
			"terminal_id": {Type: schema.String, Required: true, Desc: "Terminal ID to use."},
			"path":        {Type: schema.String, Required: true, Desc: "Absolute or relative file path."},
			"max_bytes":   {Type: schema.Integer, Required: false, Desc: "Limit output size (default 200000)."},
		}),
	}, ReadFile)
	return readTool
}

func NewWriteFileTool() tool.InvokableTool {
	writeTool := utils.NewTool(&schema.ToolInfo{
		Name:  "terminal_write_file",
		Desc:  "Write content to a file using cat heredoc. Provide terminal_id, path, and content. Overwrite defaults to true.",
		Extra: map[string]any{},
		ParamsOneOf: schema.NewParamsOneOfByParams(map[string]*schema.ParameterInfo{
			"terminal_id": {Type: schema.String, Required: true, Desc: "Terminal ID to use."},
			"path":        {Type: schema.String, Required: true, Desc: "Target file path."},
			"content":     {Type: schema.String, Required: true, Desc: "Content to write."},
			"overwrite":   {Type: schema.Boolean, Required: false, Desc: "Overwrite (true) or append (false)."},
		}),
	}, WriteFile)
	return writeTool
}
