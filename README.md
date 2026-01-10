# Choraleia

A multi-asset terminal and AI assistance tool built with Wails3 (Go + React, MUI, Xterm). It provides unified asset (hosts/local) management, WebSocket terminal sessions, multi-model AI chat with agent tools, workspace management, and browser automation.

![demo](./docs/imgs/demo.png)

## Features

### Terminal Management
- WebSocket-based terminal sessions (`/terminal/connect/:assetId`)
- Support for SSH and local PTY connections
- Flow control with pause/resume
- Terminal output capture for AI context

### Workspace System
- Multiple runtime types: local, Docker (local/remote)
- Per-workspace tool configuration
- Workspace-scoped conversations

### AI Assistant
- Multi-provider support: OpenAI, Claude, Gemini, DeepSeek, Ark, Qwen, Qianfan, Ollama
- Agent tools for file operations, command execution, and search
- Streaming responses with SSE
- Conversation branching and editing

### Browser Automation
- Docker-based headless Chrome (chromedp/headless-shell)
- Multi-tab browser instances
- Real-time screenshot preview
- AI-controllable browser actions (navigate, click, input, scroll, extract)

### Asset Management
- REST CRUD for assets
- SSH config import and parsing
- Tunnel management

### Two Run Modes
- **GUI**: Wails desktop application
- **Headless**: Pure API/static server

## Quick Start

### Prerequisites
- Go 1.21+
- Node.js 18+
- Docker (for browser automation)

### Build and Run

```bash
# GUI mode
go build -o bin/choraleia .
./bin/choraleia

# Headless mode
go build -tags headless -o bin/choraleia-headless .
./bin/choraleia-headless
```

### Frontend Development

```bash
cd frontend
npm install
npm run dev

# Set API base for cross-origin
VITE_API_BASE_URL=http://127.0.0.1:8088 npm run dev
```

## Configuration

### Server (`~/.choraleia/config.yaml`)
```yaml
server:
  host: 127.0.0.1
  port: 8088
```

### Database
SQLite database: `~/.choraleia/choraleia.db`

## API Summary

| Category | Endpoints |
|----------|-----------|
| Terminal | `GET /terminal/connect/:assetId` (WebSocket) |
| Assets | `/api/assets` CRUD |
| Models | `/api/models` CRUD |
| Workspaces | `/api/workspaces` CRUD |
| Chat | `POST /api/v1/chat/completions` (OpenAI-compatible) |
| Conversations | `/api/v1/conversations` CRUD |
| Browser | `/api/browser/*` |
| Events | `GET /api/events/ws` (WebSocket) |

See `docs/API_PROTOCOL.md` for full API documentation.

## AI Agent Tools

### Workspace Tools
- `workspace_read_file` - Read file content
- `workspace_write_file` - Write to file
- `workspace_list_dir` - List directory
- `workspace_search_files` - Search files
- `workspace_grep` - Search content
- `workspace_exec_command` - Execute command
- `workspace_exec_script` - Execute script

### Browser Tools
- `browser_start` / `browser_close` - Lifecycle
- `browser_go_to_url` / `browser_web_search` - Navigation
- `browser_click_element` / `browser_input_text` - Interaction
- `browser_scroll_down` / `browser_scroll_up` / `browser_get_scroll_info` - Scrolling
- `browser_extract_content` / `browser_screenshot` - Content
- `browser_open_tab` / `browser_switch_tab` / `browser_close_tab` - Tabs


## Directory Structure

```
./
├── main.go / main_headless.go    # Entry points
├── router.go                      # Route registration
├── pkg/
│   ├── service/                   # Business logic
│   │   ├── agent_service.go       # AI agent
│   │   ├── browser_service.go     # Browser automation
│   │   ├── chat_service.go        # Chat management
│   │   └── terminal_service.go    # Terminal sessions
│   ├── tools/                     # AI tools
│   │   ├── browser/               # Browser tools
│   │   └── workspace/             # Workspace tools
│   └── handler/                   # HTTP handlers
└── frontend/
    └── src/
        ├── components/
        │   ├── workspaces/        # Workspace UI
        │   └── ai-assitant/       # Chat UI
        └── api/                   # API clients
```

## Documentation

- [Architecture](docs/ARCHITECTURE.md) - System design
- [API Protocol](docs/API_PROTOCOL.md) - API reference
- [Event System](docs/EVENT_SYSTEM.md) - Real-time events
- [Changelog](CHANGELOG.md) - Version history

## Contributing

See `CONTRIBUTING.md` for guidelines.

## Security

See `SECURITY.md` for reporting vulnerabilities.

## License

See `LICENSE` for details.
