# AI Assistant Integration Guide

Your Go + eino backend and frontend assistant-ui are now communicating correctly. Below is the complete setup & usage guide:

## Completed Integration

### 1. Backend AI Service (ai_service.go)
- Uses eino framework OpenAI extension
- Supports streaming & non-stream responses
- Provides `/api/chat/completions` and `/api/chat/completions/stream`
- Automatically converts message formats

### 2. Frontend AI Component (ai-assistant.tsx)
- Uses assistant-ui `useExternalStoreRuntime`
- Connects to Go backend API
- Supports full chat UI

### 3. Router Configuration (router.go)
- AI chat routes added
- Includes CORS support

## Configuration Steps

### 1. Set Environment Variables
Create `.env` file or export variables:
```bash
export OPENAI_API_KEY="your_openai_api_key_here"
export OPENAI_MODEL="gpt-4"
export SERVER_PORT="8088"
```

### 2. Run Application
```bash
go build -o bin/choraleia
./bin/choraleia
```

### 3. Use AI Assistant
- After startup, AI assistant component auto-connects to backend
- Users interact via frontend chat UI
- Messages sent via HTTP API to Go eino service

## API Endpoints

### Non-stream Chat
```
POST http://localhost:8088/api/chat/completions
Content-Type: application/json
{
  "messages": [
    { "id": "msg_1", "role": "user", "content": "Hello!", "createdAt": 1234567890 }
  ]
}
```

### Stream Chat
```
POST http://localhost:8088/api/chat/completions/stream
Content-Type: application/json
{
  "messages": [
    { "id": "msg_1", "role": "user", "content": "Hello!", "createdAt": 1234567890 }
  ]
}
```

## File Structure
- `ai_service.go` - AI service implementation
- `config.go` - configuration management
- `router.go` - updated routing
- `frontend/src/components/ai-assitant/AiAssistant.tsx` - frontend AI component

## Notes
1. **API Key**: Must set valid OpenAI API Key
2. **CORS**: Cross-origin requests supported
3. **Error Handling**: Includes full error logging & handling
4. **Timeout**: 30s request timeout

## Extendable Features
You can easily extend:
- Support more AI models
- Implement chat history storage
- Add user authentication
- Support file upload & processing

Your eino backend and assistant-ui frontend are now fully integrated. You can start using AI assistant features!
