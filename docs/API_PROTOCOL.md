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

## REST Paths
| Resource | Method | Path | Description |
|------|------|------|------|
| Asset | GET | /api/assets | List |
| Asset | POST | /api/assets | Create |
| Asset | GET | /api/assets/:id | Details |
| Asset | PUT | /api/assets/:id | Update |
| Asset | DELETE | /api/assets/:id | Delete |
| Asset | POST | /api/assets/import/ssh | Import ~/.ssh/config |
| Asset | GET | /api/assets/ssh-config | Parse ~/.ssh/config |
| Model | GET | /api/models | List |
| Model | POST | /api/models | Add |
| Model | PUT | /api/models/:id | Edit |
| Model | DELETE | /api/models/:id | Delete |
| Model | POST | /api/models/test | Connection Test |
| Conversation | GET | /api/conversations | List (filterable by asset_id) |
| Conversation | POST | /api/conversations | Create |
| Conversation | GET | /api/conversations/:id | Details |
| Conversation | PUT | /api/conversations/:id/title | Update Title |
| Conversation | GET | /api/conversations/:id/messages | Message List |
| Conversation | DELETE | /api/conversations/:id | Delete |
| AI Chat | POST | /api/chat | Submit Message |

## WebSocket
`/terminal/connect/:assetId`

### Message Base
```json
{ "type": "TermInput" }
```

### Types & Examples
- TermSetSessionId
```json
{ "type": "TermSetSessionId", "session_id": "tab-key" }
```
- TermResize
```json
{ "type": "TermResize", "rows": 40, "cols": 120 }
```
- TermInput
```json
{ "type": "TermInput", "data": "ls -la\n" }
```
- TermPause
```json
{ "type": "TermPause", "pause": true }
```
- TermOutputRequest
```json
{ "type": "TermOutputRequest", "request_id": "req-1", "lines": 200 }
```
- TermOutputResponse
```json
{ "type": "TermOutputResponse", "request_id": "req-1", "success": true, "output": ["line1", "line2"] }
```

### Flow Control
- When backend exceeds HIGH threshold the frontend may send `TermPause`; resume when LOW threshold reached.

### Size Synchronization
- Frontend observes container size changes and sends TermResize; backend updates PTY.

## Error Handling Recommendations
- Unknown `type`: backend logs error; no echo back
- SSH connection error: frontend terminal writes a red warning and may trigger reconnect logic
