# Architecture Overview

## Overview
- Frontend: React + MUI + Xterm, theme adapts automatically to terminal.
- Backend: Go (Gin) + WebSocket terminal service + Asset/Model/Conversation REST APIs.
- Message Protocol: term.go defines types, dynamically parsed based on Base.Type.

## Terminal Service Flow
1. Frontend initiates `ws /terminal/connect/:assetId`
2. First message sends `TermSetSessionId` to map Tab -> Session
3. Backend establishes SSH/local session (currently only SSH/local implemented)
4. Size change -> `TermResize`; user input -> `TermInput`
5. Flow control: High watermark pause -> frontend sends `TermPause` (pause=true), Low watermark resume
6. Output capture: frontend sends `TermOutputRequest` to fetch recent lines

## Flow Control Parameters
- HIGH=100000, LOW=20000 (terminal_service.go) pause/resume thresholds

## Static Asset Strategy
- The frontend build output (`frontend/dist`) is embedded into the Go binary and served by the Gin server in both GUI and headless builds.
- Requests that do not match backend routes (and look like browser navigations) fall back to `index.html` (SPA routing).
- The static middleware does not intercept backend endpoints such as `/api`, `/terminal`, and `/healthz`.

## Model Configuration
- `~/.choraleia/model.json` persists model list
- Providers supported: ark, deepseek, claude, gemini, ollama, openai, qianfan, qwen

## Security & Future
- Currently no auth; recommend adding token validation middleware
- Terminal data is in-memory only; can extend with ring buffer/persistence later
