# API & WebSocket Protocol

## Server Address and Base URL
The backend server bind address is configured via `~/.choraleia/config.yaml`:

```yaml
server:
  host: 127.0.0.1
  port: 8088
```

- REST base URL: `http://{server.host}:{server.port}`
- WebSocket base URL: `ws://{server.host}:{server.port}`

Notes:
- If you serve the UI over HTTPS, use `https://...` for REST and `wss://...` for WebSocket.
- `server.host` is a bind address. If you bind to `0.0.0.0`, clients must connect via a real IP or hostname (for example `http://192.168.1.10:8088`), not `http://0.0.0.0:8088`.

In the desktop GUI, the frontend is loaded from the same HTTP server, so same-origin requests work by default.

## REST API Overview

### Asset Management
| Method | Path | Description |
|--------|------|-------------|
| GET | /api/assets | List all assets |
| POST | /api/assets | Create asset |
| GET | /api/assets/:id | Get asset details |
| PUT | /api/assets/:id | Update asset |
| DELETE | /api/assets/:id | Delete asset |
| POST | /api/assets/import/ssh | Import from ~/.ssh/config |
| GET | /api/assets/ssh-config | Parse ~/.ssh/config |

### Model Management
| Method | Path | Description |
|--------|------|-------------|
| GET | /api/models | List models |
| POST | /api/models | Add model |
| PUT | /api/models/:id | Update model |
| DELETE | /api/models/:id | Delete model |
| POST | /api/models/test | Test model connection |

### Workspace Management
| Method | Path | Description |
|--------|------|-------------|
| GET | /api/workspaces | List workspaces |
| POST | /api/workspaces | Create workspace |
| GET | /api/workspaces/:id | Get workspace |
| PUT | /api/workspaces/:id | Update workspace |
| DELETE | /api/workspaces/:id | Delete workspace |
| GET | /api/workspaces/:id/tools | Get workspace tools config |
| PUT | /api/workspaces/:id/tools | Update workspace tools config |

### Chat & Conversations (OpenAI-compatible)
| Method | Path | Description |
|--------|------|-------------|
| POST | /api/v1/chat/completions | Chat completions (streaming/non-streaming) |
| POST | /api/v1/chat/cancel | Cancel active stream |
| GET | /api/v1/chat/status/:conversation_id | Get stream status |
| GET | /api/v1/conversations | List conversations |
| POST | /api/v1/conversations | Create conversation |
| GET | /api/v1/conversations/:id | Get conversation |
| PATCH | /api/v1/conversations/:id | Update conversation |
| DELETE | /api/v1/conversations/:id | Delete conversation |
| GET | /api/v1/conversations/:id/messages | Get messages |

### Browser Automation
| Method | Path | Description |
|--------|------|-------------|
| GET | /api/browser/list | List active browsers for conversation |
| POST | /api/browser/start | Start browser instance |
| POST | /api/browser/close | Close browser instance |
| GET | /api/browser/screenshot/:browser_id | Get browser screenshot |
| GET | /api/browser/ws | Browser state WebSocket |

### File System (SFTP - Remote)
| Method | Path | Description |
|--------|------|-------------|
| GET | /api/sftp/ls | List remote directory |
| GET | /api/sftp/stat | Stat remote path |
| GET | /api/sftp/download | Download remote file |
| POST | /api/sftp/upload | Upload file (multipart) |
| POST | /api/sftp/mkdir | Create directory |
| POST | /api/sftp/rm | Remove file/directory |
| POST | /api/sftp/rename | Rename/move path |

### File System (Local)
| Method | Path | Description |
|--------|------|-------------|
| GET | /api/localfs/ls | List local directory (sandboxed) |
| GET | /api/localfs/stat | Stat local path (sandboxed) |
| GET | /api/localfs/download | Download local file (sandboxed) |
| POST | /api/localfs/upload | Upload file (sandboxed) |
| POST | /api/localfs/mkdir | Create directory (sandboxed) |
| POST | /api/localfs/rm | Remove file/directory (sandboxed) |
| POST | /api/localfs/rename | Rename/move path (sandboxed) |

### Tunnels
| Method | Path | Description |
|--------|------|-------------|
| GET | /api/tunnels | List tunnels |
| POST | /api/tunnels | Create tunnel |
| DELETE | /api/tunnels/:id | Delete tunnel |
| POST | /api/tunnels/:id/start | Start tunnel |
| POST | /api/tunnels/:id/stop | Stop tunnel |

### Tasks
| Method | Path | Description |
|--------|------|-------------|
| GET | /api/tasks | List tasks |
| GET | /api/tasks/:id | Get task |
| POST | /api/tasks/:id/cancel | Cancel task |

### Quick Commands
| Method | Path | Description |
|--------|------|-------------|
| GET | /api/quickcmds | List quick commands |
| POST | /api/quickcmds | Create quick command |
| PUT | /api/quickcmds/:id | Update quick command |
| DELETE | /api/quickcmds/:id | Delete quick command |

Notes:
- LocalFS paths are always relative to the LocalFS sandbox root: `~/.choraleia/localfs`.
- Path traversal (e.g. `..`) is rejected.

## WebSocket Endpoints

### Terminal WebSocket
`GET /terminal/connect/:assetId`

#### Message Types
| Type | Fields | Description |
|------|--------|-------------|
| TermSetSessionId | `session_id` | Set session ID for tab mapping |
| TermResize | `rows`, `cols` | Resize terminal |
| TermInput | `data` | User input |
| TermPause | `pause` (bool) | Pause/resume output |
| TermOutputRequest | `request_id`, `lines` | Request recent output |
| TermOutputResponse | `request_id`, `output[]`, `success`, `error` | Output response |

#### Examples
```json
{ "type": "TermSetSessionId", "session_id": "tab-key" }
{ "type": "TermResize", "rows": 40, "cols": 120 }
{ "type": "TermInput", "data": "ls -la\n" }
{ "type": "TermPause", "pause": true }
{ "type": "TermOutputRequest", "request_id": "req-1", "lines": 200 }
{ "type": "TermOutputResponse", "request_id": "req-1", "success": true, "output": ["line1", "line2"] }
```

### Event WebSocket
`GET /api/events/ws?events=event1,event2,...`

Real-time event notifications. See `docs/EVENT_SYSTEM.md` for details.

### Browser WebSocket
`GET /api/browser/ws?conversation_id=xxx`

Real-time browser state updates and screenshots.

#### Message Types
| Type | Description |
|------|-------------|
| `browser_list` | List of active browsers |
| `screenshot` | Browser screenshot data (base64) |
| `state_change` | Browser state changed |

## Chat Completions API

### Request (POST /api/v1/chat/completions)
```json
{
  "model": "gpt-4",
  "messages": [
    {"role": "user", "content": "Hello"}
  ],
  "stream": true,
  "workspace_id": "workspace-uuid",
  "conversation_id": "conversation-uuid"
}
```

### Stream Status (GET /api/v1/chat/status/:conversation_id)
```json
{
  "conversation_id": "xxx",
  "is_streaming": true
}
```

## Flow Control
- When backend exceeds HIGH threshold (100000 bytes), frontend may send `TermPause`
- Resume when LOW threshold (20000 bytes) is reached

## Error Handling
- Unknown message `type`: backend logs error, no echo back
- SSH connection error: frontend terminal shows red warning, may trigger reconnect
