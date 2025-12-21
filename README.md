# Choraleia

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
./
  main.go / main_headless.go / router.go / static.go
  pkg/
    service/terminal_service.go      # terminal core logic
    message/term.go                  # WebSocket protocol
    models/asset.go, model.go        # data and config
  frontend/
    src/App.tsx                      # root React component
    src/components/assets/Terminal.tsx
    src/themes.ts                    # theme customization
```

## Environment Variables
This project does not require any environment variables for normal use.

For frontend development only, you can set:

| Variable          | Purpose                                             |
|------------------|-----------------------------------------------------|
| VITE_API_BASE_URL | Override API base URL when running the frontend on a different origin (e.g. Vite dev server) |

## Configuration (YAML)
Choraleia reads its runtime configuration from a YAML file under your home directory:

- Config file: `~/.choraleia/config.yaml`

The file is created automatically on first start if it doesn't exist.

Example:
```yaml
server:
  host: 127.0.0.1
  port: 8088
```

Defaults:
- `server.host`: `127.0.0.1`
- `server.port`: `8088`

### GUI (Wails) URL behavior
The desktop GUI loads the same HTTP server started by the backend.
It opens:

- `http://{server.host}:{server.port}`

This means the frontend can use same-origin requests by default.

### Frontend dev note (Vite)
If you run `npm run dev`, the frontend will be on a different origin (usually `http://localhost:5173`).
In that case, set `VITE_API_BASE_URL` so the frontend knows where the Go server is:

```bash
VITE_API_BASE_URL=http://127.0.0.1:8088
```

## Run Modes

### GUI (Wails desktop + API)
```bash
go build -o bin/choraleia .
./bin/choraleia
```

### Headless API + static server
The headless build starts the same Gin server (API + WebSocket + embedded frontend).

```bash
go build -tags headless -o bin/choraleia-headless .
./bin/choraleia-headless
```

## Build Modes
- GUI + API: `go build -o bin/choraleia .`
- Headless API: `go build -tags headless -o bin/choraleia-headless .`

Explanation:
- GUI build tag: `//go:build !headless`
- Headless build tag: `//go:build headless`

## Quick Smoke Test
```bash
# GUI
go build -o bin/choraleia . && ./bin/choraleia &

# Headless
go build -tags headless -o bin/choraleia-headless . && ./bin/choraleia-headless &

# Check port (default)
lsof -i:8088
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
