# AI Agent Terminal Assistant Usage Guide

You now have a powerful AI Agent terminal assistant built with `NewChatModelAgent` and equipped with tools to fetch terminal output.

## Capabilities

### 🤖 AI Agent Features
- **Intelligent Dialogue**: Based on eino framework `NewChatModelAgent`
- **Tool Invocation**: Actively fetch and analyze terminal output
- **Context Awareness**: Maintains dialogue history and terminal state understanding

### 🛠 Built-in Tools

#### 1. terminal_get_output
- **Purpose**: Fetch recent output of a specified terminal session
- **Use Case**: Analyze command results, diagnose errors, interpret output
- **Parameters**:
  - `terminal_id`: Terminal session ID (required)
  - `lines`: Number of lines to retrieve, default 20 (optional)

#### 2. terminal_exec_command
- **Purpose**: Execute a shell command inside a specified terminal and return output & exit code
- **Use Case**: Diagnostics, file inspection, running scripts
- **Parameters**:
  - `terminal_id`: Target terminal ID (required)
  - `command`: Shell command to run (required, no newline)
  - `timeout_seconds`: Timeout waiting for output (optional, default 30)

## API Endpoints

### Basic AI Chat (no tools)
```bash
POST http://localhost:8088/api/chat/completions
POST http://localhost:8088/api/chat/completions/stream
```

### AI Agent Chat (with tools)
```bash
POST http://localhost:8088/api/agent/chat
POST http://localhost:8088/api/agent/chat/stream
```

## Request Example
```json
{
  "messages": [
    {
      "id": "msg_1",
      "role": "user",
      "content": "I just ran ls -la, please help analyze the output",
      "createdAt": 1234567890
    }
  ]
}
```

## AI Agent Workflow
1. **Receive user request**: "I just ran ls -la, help analyze the output"
2. **Determine need for tools**: AI detects need to view terminal output
3. **Invoke tool**: Calls `terminal_get_output` automatically
4. **Analyze output**: Reads actual terminal output content
5. **Provide suggestions**: Gives professional explanation & recommendations

## Terminal Output Monitoring

### Automatic Capture
- **Output Tracking**: All terminal output captured to conversation history
- **Command Tracking**: User executed commands recorded
- **Session Management**: Each terminal connection has unique session ID

### Session ID Format
```
term_{assetId}_{timestamp}
```

## Frontend Integration

AI Assistant component is already configured to connect to Agent API:
```typescript
const response = await fetch('http://localhost:8088/api/agent/chat', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    messages: [...messages, userMessage].map(msg => ({
      id: msg.id,
      role: msg.role,
      content: msg.content,
      createdAt: Math.floor(msg.createdAt.getTime() / 1000),
    })),
  }),
});
```

## Practical Scenarios

### 1. Error Diagnosis
**User**: "My program build failed, can you check what's wrong?"
**AI Agent**:
1. Calls `terminal_get_output` to fetch build output
2. Analyzes error lines
3. Gives concrete fix suggestions

### 2. Performance Analysis
**User**: "I just ran top, how is system performance?"
**AI Agent**:
1. Fetches top output
2. Analyzes CPU and memory usage
3. Suggests optimization steps

### 3. File Operation Guidance
**User**: "I want to find all .log files, what should I do?"
**AI Agent**:
1. Suggests using `find` command
2. If user runs it, auto fetch output
3. Explains results & next actions

## Environment Variables
```bash
export OPENAI_API_KEY="your_api_key"  # Not required if using Ark provider
export OPENAI_MODEL="gpt-4"           # Optional, default doubao
export SERVER_PORT="8088"             # Optional, default 8088
```

## Model Configuration
Current Ark provider doubao model:
- **Model**: doubao-seed-1.6-250615
- **API**: ark.cn-beijing.volces.com
- **Timeout**: 30s
- **Retries**: 3

## Start & Test
### 1. Start Application
```bash
go build -o bin/omniterm
./bin/omniterm
```
### 2. Test Agent API
```bash
curl -X POST http://localhost:8088/api/agent/chat \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [
      {
        "id": "test_1",
        "role": "user",
        "content": "Can you show me recent terminal output?",
        "createdAt": 1234567890
      }
    ]
  }'
```

## Core Advantages
1. **Real-time analysis**: AI reads actual terminal output
2. **Smart tool invocation**: Decides when to fetch terminal data
3. **Professional suggestions**: Based on real output
4. **Context preservation**: Keeps dialogue & terminal state
5. **Multi-turn interaction**: Handles complex troubleshooting flows

Your AI assistant now not only chats but truly understands and analyzes your terminal operations, becoming your professional terminal helper!
