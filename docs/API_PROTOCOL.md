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
| SFTP | GET | /api/sftp/ls | List remote directory entries (query: asset_id, path) |
| SFTP | GET | /api/sftp/stat | Stat a remote path (query: asset_id, path) |
| SFTP | GET | /api/sftp/download | Download a remote file (query: asset_id, path) |
| SFTP | POST | /api/sftp/upload | Upload a file (multipart: file; query: asset_id, path, overwrite) |
| SFTP | POST | /api/sftp/mkdir | Create directory (query: asset_id, path) |
| SFTP | POST | /api/sftp/rm | Remove file or empty directory (query: asset_id, path) |
| SFTP | POST | /api/sftp/rename | Rename/move path (query: asset_id, from, to) |
| LocalFS | GET | /api/localfs/ls | List local directory entries (query: path; sandboxed) |
| LocalFS | GET | /api/localfs/stat | Stat a local path (query: path; sandboxed) |
| LocalFS | GET | /api/localfs/download | Download a local file (query: path; sandboxed) |
| LocalFS | POST | /api/localfs/upload | Upload a file (multipart: file; query: path, overwrite; sandboxed) |
| LocalFS | POST | /api/localfs/mkdir | Create local directory (query: path; sandboxed) |
| LocalFS | POST | /api/localfs/rm | Remove local file or empty directory (query: path; sandboxed) |
| LocalFS | POST | /api/localfs/rename | Rename/move local path (query: from, to; sandboxed) |

Notes:
- LocalFS paths are always relative to the LocalFS sandbox root: `~/.choraleia/localfs`.
- The API accepts paths that start with `/` for convenience, but they are still treated as sandbox-relative.
- Path traversal (e.g. `..`) is rejected.

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
