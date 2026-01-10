# Architecture Overview

## Overview

Choraleia is a multi-asset terminal and AI assistance tool with:

- **Frontend**: React + MUI + Xterm.js + assistant-ui
- **Backend**: Go (Gin) + WebSocket services + REST APIs + SQLite
- **AI**: Multi-provider support with agent tools (eino framework)
- **Browser Automation**: Docker-based headless Chrome via chromedp

## System Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         Frontend (React)                         │
├─────────────┬─────────────┬─────────────┬─────────────┬─────────┤
│  Terminal   │  Workspace  │  AI Chat    │  Browser    │  Assets │
│  (Xterm.js) │  Manager    │  (assistant │  Preview    │  Tree   │
│             │             │   -ui)      │             │         │
└──────┬──────┴──────┬──────┴──────┬──────┴──────┬──────┴────┬────┘
       │             │             │             │           │
       │ WebSocket   │ HTTP        │ SSE         │ WebSocket │ HTTP
       ▼             ▼             ▼             ▼           ▼
┌─────────────────────────────────────────────────────────────────┐
│                      Backend (Go + Gin)                          │
├─────────────┬─────────────┬─────────────┬─────────────┬─────────┤
│  Terminal   │  Workspace  │    Chat     │  Browser    │  Asset  │
│  Service    │  Service    │   Service   │  Service    │ Service │
├─────────────┴─────────────┴──────┬──────┴─────────────┴─────────┤
│                                  │                               │
│  ┌─────────────┐  ┌─────────────┴─────────────┐                 │
│  │   SQLite    │  │      Agent Service        │                 │
│  │  (gorm.io)  │  │  (eino + tools registry)  │                 │
│  └─────────────┘  └─────────────┬─────────────┘                 │
│                                  │                               │
│                    ┌─────────────┴─────────────┐                │
│                    │      Tool Categories      │                │
│                    ├───────────┬───────────────┤                │
│                    │ Workspace │    Browser    │                │
│                    │  Tools    │    Tools      │                │
│                    └─────┬─────┴───────┬───────┘                │
└──────────────────────────┼─────────────┼────────────────────────┘
                           │             │
                           ▼             ▼
                    ┌────────────┐ ┌───────────────┐
                    │ Local/SSH  │ │    Docker     │
                    │ Execution  │ │ (headless-    │
                    └────────────┘ │  shell)       │
                                   └───────────────┘
```

## Key Components

### Terminal Service
- WebSocket endpoint: `/terminal/connect/:assetId`
- Supports local PTY and SSH connections
- Flow control with HIGH/LOW watermarks (100KB/20KB)
- Output capture for AI context

### Workspace Service
- Manages workspace configurations
- Supports multiple runtime types:
  - `local` - Local filesystem
  - `docker-local` - Local Docker container
  - `docker-remote` - Remote Docker via SSH
- Tool configuration per workspace

### Chat Service
- OpenAI-compatible API (`/api/v1/chat/completions`)
- Streaming support with SSE
- Active stream tracking per conversation
- Stream status API for UI state management

### Agent Service
- Built on cloudwego/eino framework
- Tool registry with categories:
  - **Workspace Tools**: file operations, command execution, search
  - **Browser Tools**: navigation, interaction, content extraction
- Dynamic tool loading based on workspace configuration

### Browser Service
- Docker-based headless Chrome (chromedp/headless-shell)
- Features:
  - Multi-tab support per browser instance
  - Real-time screenshots via WebSocket
  - Automatic idle timeout (10 minutes)
  - Support for local and remote Docker
  - SSH tunnel for remote browsers
- Per-conversation browser isolation
- State persistence in SQLite

## Data Flow

### AI Chat with Tools
```
User Input → Chat Service → Agent Service → Tool Execution
                                    ↓
                            Tool Registry
                                    ↓
                    ┌───────────────┼───────────────┐
                    ▼               ▼               ▼
              FS Service    Terminal Service  Browser Service
```

### Browser Automation
```
AI Tool Call → Browser Service → Docker Container
                     ↓                   ↓
              chromedp (CDP)      headless-shell
                     ↓                   ↓
              Screenshot ← ─ ─ ─ ─ Chrome DevTools
                     ↓
              WebSocket → Frontend Preview
```

## Directory Structure

```
./
├── main.go / main_headless.go    # Entry points
├── router.go                      # Route registration
├── static.go                      # Embedded frontend
├── pkg/
│   ├── config/                    # Configuration
│   ├── db/                        # Database models
│   ├── event/                     # Event system
│   ├── handler/                   # HTTP handlers
│   ├── message/                   # WebSocket protocols
│   ├── models/                    # Domain models
│   ├── service/                   # Business logic
│   │   ├── agent_service.go       # AI agent orchestration
│   │   ├── agent_tools.go         # Tool integration
│   │   ├── browser_service.go     # Browser automation
│   │   ├── chat_service.go        # Chat management
│   │   ├── fs_service.go          # File system ops
│   │   ├── terminal_service.go    # Terminal sessions
│   │   └── workspace_service.go   # Workspace management
│   ├── tools/                     # AI tool definitions
│   │   ├── browser/               # Browser tools
│   │   ├── workspace/             # Workspace tools
│   │   └── registry.go            # Tool registry
│   └── utils/                     # Utilities
└── frontend/
    └── src/
        ├── components/
        │   ├── ai-assitant/       # AI chat UI
        │   ├── assets/            # Asset management
        │   └── workspaces/        # Workspace UI
        ├── api/                   # API clients
        └── state/                 # State management
```

## Configuration

### Server Config (`~/.choraleia/config.yaml`)
```yaml
server:
  host: 127.0.0.1
  port: 8088
```

### Database
- SQLite database: `~/.choraleia/choraleia.db`
- Auto-migration on startup

### Model Config
- Stored in database (models table)
- Providers: ark, deepseek, claude, gemini, ollama, openai, qianfan, qwen

## Security Considerations

- No built-in authentication (add middleware as needed)
- LocalFS sandboxed to `~/.choraleia/localfs`
- Browser containers isolated per conversation
- SSH keys handled via asset configuration

## Build Modes

- **GUI**: `go build -o bin/choraleia .`
- **Headless**: `go build -tags headless -o bin/choraleia-headless .`

Both modes serve the embedded frontend and provide identical API functionality.

## Adding Custom Tools

### 1. Define Tool

```go
// pkg/tools/custom/my_tool.go
package custom

import (
    "context"
    "github.com/choraleia/choraleia/pkg/tools"
    "github.com/cloudwego/eino/components/tool"
    "github.com/cloudwego/eino/components/tool/utils"
    "github.com/cloudwego/eino/schema"
)

type MyToolInput struct {
    Param1 string `json:"param1"`
}

func NewMyTool(tc *tools.ToolContext) tool.InvokableTool {
    return utils.NewTool(&schema.ToolInfo{
        Name: "my_tool",
        Desc: "Tool description",
        ParamsOneOf: schema.NewParamsOneOfByParams(map[string]*schema.ParameterInfo{
            "param1": {Type: schema.String, Required: true, Desc: "Parameter description"},
        }),
    }, func(ctx context.Context, input *MyToolInput) (string, error) {
        return "Result", nil
    })
}
```

### 2. Register Tool

```go
// pkg/tools/custom/init.go
func init() {
    tools.Register(tools.ToolDefinition{
        ID:          "my_tool",
        Name:        "My Tool",
        Description: "Tool description for UI",
        Category:    tools.CategoryWorkspace,
        Scope:       tools.ScopeBoth,
    }, NewMyTool)
}
```

### 3. Import Package

```go
// pkg/tools/registry.go
import _ "github.com/choraleia/choraleia/pkg/tools/custom"
```

