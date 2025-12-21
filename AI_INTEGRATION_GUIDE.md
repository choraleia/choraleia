# AI Assistant Integration Guide

This project exposes an AI chat endpoint from the Go backend and a React assistant UI in the frontend.

## Backend

### Chat endpoint
- `POST /api/chat`

This endpoint is registered in `router.go`.

## Frontend

- The main AI assistant UI lives under `frontend/src/components/ai-assitant/`.
- The frontend uses `getApiUrl("/api/...")` to call the backend.

## Configuration

The backend server address is configured via:

- `~/.choraleia/config.yaml`

Example:

```yaml
server:
  host: 127.0.0.1
  port: 8088
```

### Frontend development (Vite)

If you run the Vite dev server (`npm run dev`), set:

```bash
VITE_API_BASE_URL=http://127.0.0.1:8088
```

so the frontend can reach the Go server.

## Notes
- The desktop GUI loads the frontend from the same Go HTTP server (`http://{server.host}:{server.port}`), so same-origin requests work by default.
- If you need to add authentication, implement it as Gin middleware for `/api` and `/terminal`.
