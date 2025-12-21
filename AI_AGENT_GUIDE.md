# AI Agent Terminal Assistant Usage Guide

This document describes how Choraleia's AI assistant can interact with terminal sessions.

## What exists today
- AI chat endpoint: `POST /api/chat`
- Terminal WebSocket: `GET /terminal/connect/:assetId`
- Terminal output retrieval: the frontend can request recent output over the WebSocket via `TermOutputRequest`.

## Notes on "agent tools"
The backend does not currently expose separate REST endpoints such as `/api/agent/chat` or `/api/chat/completions`.
If you want an agent-style API (tools + streaming), it should be added explicitly to `router.go` and documented here.

## Terminal output retrieval (WebSocket)

To retrieve recent output for a terminal session, the frontend sends:

```json
{ "type": "TermOutputRequest", "request_id": "req-1", "lines": 200 }
```

The backend responds with:

```json
{ "type": "TermOutputResponse", "request_id": "req-1", "success": true, "output": ["..."] }
```

For the full protocol, see `docs/API_PROTOCOL.md` and `pkg/message/term.go`.

## Configuration
The server bind address is configured via `~/.choraleia/config.yaml`:

```yaml
server:
  host: 127.0.0.1
  port: 8088
```
