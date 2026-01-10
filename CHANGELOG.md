# Changelog

Following Keep a Changelog and Semantic Versioning.

## [Unreleased]

### Added
- **Browser Automation**: Docker-based headless Chrome support via chromedp
  - Multi-tab browser instances per conversation
  - Real-time screenshot preview via WebSocket
  - Browser tools for AI agents: navigation, click, input, scroll, extract content
  - `browser_get_scroll_info` tool for page scroll state
  - Automatic idle timeout (10 minutes)
  - Support for local and remote Docker (via SSH tunnel)
  - Browser state persistence in SQLite
- **Workspace System**: Full workspace management
  - Multiple runtime types: local, docker-local, docker-remote
  - Per-workspace tool configuration
  - Workspace-scoped conversations
- **Chat Improvements**
  - Stream status API (`GET /api/v1/chat/status/:conversation_id`)
  - Per-conversation running state isolation
  - OpenAI-compatible chat completions API
- **AI Agent Tools**
  - Tool registry with categories (workspace, browser)
  - Dynamic tool loading based on workspace config
  - Built-in workspace tools: file ops, command execution, search
- **Event System**: VS Code-style event notifications
  - WebSocket-based real-time updates
  - Event types: fs, asset, tunnel, container, task
- **Tunnel Management**: SSH tunnel support for remote connections
- **Task System**: Background task tracking and management
- **Quick Commands**: Saved command snippets

### Changed
- Unified dark gray primary theme; terminal forced dark background
- Migrated to SQLite database with gorm.io
- Chat UI migrated to assistant-ui framework
- Improved terminal flow control

### Fixed
- WebSocket connection resource leak in browser preview
- Conversation running state isolation between sessions
- Browser container cleanup on program restart

## [0.1.0] - Initial Release

### Added
- Initial documentation and policy descriptions
- Terminal management with WebSocket support
- Asset management with SSH config import
- Multi-provider AI chat (ark, deepseek, claude, gemini, ollama, openai, qianfan, qwen)
- GUI (Wails) and headless run modes
- Light/dark theme support
- Embedded static frontend
