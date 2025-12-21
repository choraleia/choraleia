# OmnitTerm

A multi-asset terminal and AI assistance tool built with Wails3 (Go + React, MUI, Xterm). It provides unified asset (hosts/local) management, WebSocket terminal sessions, multi-model AI chat, and an optional headless pure backend mode.

![demo](./docs/imgs/demo.png)

Themes live in `frontend/src/themes.ts`. The main terminal component is `frontend/src/components/assets/Terminal.tsx`, which sets a dark background and auto-resize behavior based on the active theme.

## Features
- Terminal management: WebSocket `/terminal/connect/:assetId`, resize, pause/resume output stream
- Asset management: REST CRUD + SSH config import and parse
- AI Assistant: multi-provider (ark, deepseek, claude, gemini, ollama, openai, qianfan, qwen) chat and automatic title generation
- Two run modes: GUI (Wails) and `headless` pure API/static server
- Light/dark themes; terminal is always rendered with a dark background
- Embedded static frontend (built `frontend/dist`) with SPA fallback and ETag caching

## Directory Structure (Key)
```text
backend
  main.go / main_headless.go / router.go
  pkg/
    service/terminal_service.go  # terminal core logic
    message/term.go              # WebSocket protocol
    models/asset.go, model.go    # data and config
frontend/
  src/App.tsx                    # root React component
  src/components/assets/Terminal.tsx
  src/themes.ts                  # theme customization
```

## Environment Variables
| Variable                | Purpose                                   | Default |
|-------------------------|-------------------------------------------|---------|
| OMNITERM_DISABLE_STATIC | Disable embedded static assets when `1`   | enabled |
| (future) OMNITERM_PORT  | Override API port                         | 8088    |
| OMNITERM_HTTP_PORT      | Static file HTTP server port (headless)   | 8080    |

## Run Modes

### GUI (Wails desktop + API)
```bash
go build -o bin/choraleia .
./bin/choraleia
```

### Headless API server
```bash
go build -tags headless -o bin/choraleia-headless .
./bin/choraleia-headless
```

Disable static in headless mode (optional):
```bash
OMNITERM_DISABLE_STATIC=1 go build -tags headless -o bin/choraleia-headless .
```

## Build Modes
- GUI + API: `go build -o bin/choraleia .`
- Headless API (with optional static): `go build -tags headless -o bin/choraleia-headless .`

Explanation:
- GUI build tag: `//go:build !headless`
- Headless build tag: `//go:build headless`
- Disable static: `OMNITERM_DISABLE_STATIC=1`
- Static port override: `OMNITERM_HTTP_PORT` (default 8080)
- Standalone server: `go build -o choraleia-headless -tags headless .`

## Quick Smoke Test
```bash
# GUI
go build -o bin/choraleia . && ./bin/choraleia &

# Headless
go build -tags headless -o bin/choraleia-headless . && ./bin/choraleia-headless &

# Check ports
lsof -i:8088 -i:8080
```

## API Summary
- Terminal: `GET /terminal/connect/:assetId` (WebSocket)
- Assets: `/api/assets` CRUD; import SSH `POST /api/assets/import/ssh`; parse SSH `GET /api/assets/ssh-config`
- Models: `/api/models` CRUD; test model `POST /api/models/test`
- Conversations: `/api/conversations` list/create/update title/delete/messages
- Chat: `POST /api/chat`

For detailed API and message formats, see `docs/API_PROTOCOL.md`.

## WebSocket Protocol (term.go)

Defined in `pkg/message/term.go`:

| Type              | Fields                              | Description            |
|-------------------|-------------------------------------|------------------------|
| TermSetSessionId  | `session_id`                        | Set session ID         |
| TermResize        | `rows`, `cols`                      | Resize terminal        |
| TermInput         | `data`                              | User input             |
| TermPause         | `pause` (bool)                      | Pause/resume output    |
| TermOutputRequest | `request_id`, `lines`               | Request recent output  |
| TermOutputResponse| `request_id`, `output[]`, `success`, `error` | Output response |

## AI Assistant

The AI assistant supports multiple providers and models (ark, deepseek, claude, gemini, ollama, openai, qianfan, qwen). Core backend logic lives under `pkg/service/agent_service.go` and `pkg/service/agent_tools.go`. The main UI components live under `frontend/src/components/ai-assitant/`.

- Configure models and providers via the models API (`/api/models`) and related structs in `pkg/models/model.go`.
- Conversation and chat store logic is implemented in `pkg/service/chat_store_service.go`.
- For detailed AI integration and custom tool support, see `AI_AGENT_GUIDE.md` and `AI_INTEGRATION_GUIDE.md`.

## Development

### Backend (Go)

Requirements:
- Go (see required version in `go.mod`).

From the project root:
```bash
# Run GUI mode directly
go run ./main.go

# Run headless mode
go run -tags headless ./main_headless.go
```

### Frontend (React + Vite)

The frontend lives under `frontend/`.

```bash
cd frontend
npm install
npm run dev
```

Build the production frontend:
```bash
cd frontend
npm run build
```

The built assets will be placed in `frontend/dist` and can be embedded into the Go binary.

## Build and Packaging

This repository includes multi-platform packaging scripts under `build/`:
- Linux: AppImage and packages via NFPM (see `build/linux/`, `build/linux/nfpm/`).
- macOS: Info plist and bundling under `build/darwin/`.
- Windows: NSIS/MSIX configuration under `build/windows/`.

There are Taskfiles at the root and under `build/` to help automate builds and packaging.

## Contributing
See `CONTRIBUTING.md` for code style and submission process. Pull requests and issues are welcome.

## Security
See `SECURITY.md` to report vulnerabilities. Sensitive terminal data is not persisted; only in-memory session data is stored.

## Roadmap

See `ROADMAP.md` for the full roadmap. Summary of planned items:
- Dynamic port and environment variable `OMNITERM_PORT`.
- Multi-protocol terminal support (RDP/VNC/Database).
- Asset config validation and encryption of sensitive fields.
- Pluggable AI tool invocation.

## Additional Documentation
- Architecture overview: `docs/ARCHITECTURE.md`
- Detailed API and protocol: `docs/API_PROTOCOL.md`
- AI agent usage and integration: `AI_AGENT_GUIDE.md`, `AI_INTEGRATION_GUIDE.md`
- Change history: `CHANGELOG.md`

## License

This project is licensed under the terms described in `LICENSE`.
