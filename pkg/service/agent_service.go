package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/choraleia/choraleia/pkg/api"
	"github.com/choraleia/choraleia/pkg/message"
	"github.com/choraleia/choraleia/pkg/models"
	utils2 "github.com/choraleia/choraleia/pkg/utils"
	"github.com/cloudwego/eino-ext/components/model/ark"
	"github.com/cloudwego/eino-ext/components/model/claude"
	"github.com/cloudwego/eino-ext/components/model/deepseek"
	"github.com/cloudwego/eino-ext/components/model/gemini"
	"github.com/cloudwego/eino-ext/components/model/ollama"
	"github.com/cloudwego/eino-ext/components/model/openai"
	"github.com/cloudwego/eino-ext/components/model/qianfan"
	"github.com/cloudwego/eino-ext/components/model/qwen"
	"github.com/cloudwego/eino/adk"
	einoModel "github.com/cloudwego/eino/components/model"
	"github.com/cloudwego/eino/components/tool"
	"github.com/cloudwego/eino/compose"
	"github.com/cloudwego/eino/schema"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/gorilla/websocket"
	"google.golang.org/genai"
)

// TerminalManager manages all active terminal sessions
type TerminalManager struct {
	terminals map[string]*TerminalSession
	mutex     sync.RWMutex
	logger    *slog.Logger
}

// TerminalSession stores terminal session info
type TerminalSession struct {
	ID      string
	AssetID string
	Output  []string
	LastCmd string
	mutex   sync.RWMutex
	// websocket connection reference for sending requests
	conn *websocket.Conn
	term *Terminal // new: backend Terminal instance pointer
}

// OutputRequest represents a pending websocket output request
type OutputRequest struct {
	requestID string
	response  chan *message.TermOutputResponse
	timeout   time.Time
}

type TerminalOutputManager struct {
	pendingRequests map[string]*OutputRequest
	mutex           sync.RWMutex
}

var GlobalTerminalManager = &TerminalManager{
	terminals: make(map[string]*TerminalSession),
	logger:    utils2.GetLogger(),
}

// Global output request manager
var GlobalOutputManager = &TerminalOutputManager{
	pendingRequests: make(map[string]*OutputRequest),
}

// RegisterTerminal registers a new terminal session
func (tm *TerminalManager) RegisterTerminal(sessionID, assetID string) {
	tm.mutex.Lock()
	defer tm.mutex.Unlock()

	tm.terminals[sessionID] = &TerminalSession{
		ID:      sessionID,
		AssetID: assetID,
		Output:  make([]string, 0),
		LastCmd: "",
		mutex:   sync.RWMutex{},
	}
}

// SetTerminalConnection sets websocket connection for a session
func (tm *TerminalManager) SetTerminalConnection(sessionID string, conn *websocket.Conn) {
	tm.mutex.RLock()
	session, exists := tm.terminals[sessionID]
	tm.mutex.RUnlock()

	if !exists {
		return
	}

	session.mutex.Lock()
	defer session.mutex.Unlock()

	session.conn = conn
}

// AttachTerminal binds backend Terminal instance to session (needed for backend echo mode)
func (tm *TerminalManager) AttachTerminal(sessionID string, term *Terminal) {
	if term == nil {
		return
	}
	tm.mutex.RLock()
	session, exists := tm.terminals[sessionID]
	tm.mutex.RUnlock()
	if !exists {
		// If not registered yet (e.g. temporary ID first creation) register first
		tm.RegisterTerminal(sessionID, term.assetID)
		tm.mutex.RLock()
		session = tm.terminals[sessionID]
		tm.mutex.RUnlock()
	}
	session.mutex.Lock()
	session.term = term
	session.mutex.Unlock()
}

// RequestTerminalOutput requests terminal output via websocket
func (tm *TerminalManager) RequestTerminalOutput(terminalId string, lines int) ([]string, error) {
	tm.mutex.RLock()
	session, exists := tm.terminals[terminalId]
	tm.mutex.RUnlock()

	if !exists {
		return nil, fmt.Errorf("terminal session not found: %s", terminalId)
	}

	session.mutex.RLock()
	conn := session.conn
	session.mutex.RUnlock()

	if conn == nil {
		tm.logger.Warn("No websocket connection for terminal", "terminalId", terminalId)
		return nil, fmt.Errorf("no websocket connection for terminal: %s", terminalId)
	}

	// Generate request ID
	requestID := uuid.New().String()

	// Create response channel
	responseChan := make(chan *message.TermOutputResponse, 1)

	// Register request
	GlobalOutputManager.mutex.Lock()
	GlobalOutputManager.pendingRequests[requestID] = &OutputRequest{
		requestID: requestID,
		response:  responseChan,
		timeout:   time.Now().Add(5 * time.Second), // 5s timeout
	}
	GlobalOutputManager.mutex.Unlock()

	// Send request to frontend
	request := &message.TermOutputRequest{
		Base:      message.Base{Type: "TermOutputRequest"},
		RequestID: requestID,
		Lines:     lines,
	}

	requestBytes, err := json.Marshal(request)
	if err != nil {
		// Cleanup request
		GlobalOutputManager.mutex.Lock()
		delete(GlobalOutputManager.pendingRequests, requestID)
		GlobalOutputManager.mutex.Unlock()
		return nil, fmt.Errorf("failed to marshal request: %w", err)
	}

	session.mutex.Lock()
	err = conn.WriteMessage(websocket.TextMessage, requestBytes)
	session.mutex.Unlock()

	if err != nil {
		// Cleanup request
		GlobalOutputManager.mutex.Lock()
		delete(GlobalOutputManager.pendingRequests, requestID)
		GlobalOutputManager.mutex.Unlock()
		tm.logger.Error("Failed to send output request", "error", err, "terminalId", terminalId)
		return nil, fmt.Errorf("failed to send output request: %w", err)
	}

	// Wait response or timeout
	select {
	case response := <-responseChan:
		GlobalOutputManager.mutex.Lock()
		delete(GlobalOutputManager.pendingRequests, requestID)
		GlobalOutputManager.mutex.Unlock()
		if response.Success {
			return response.Output, nil
		} else {
			tm.logger.Error("Frontend failed to get output", "error", response.Error, "terminalId", terminalId)
			return nil, fmt.Errorf("frontend failed to get output: %s", response.Error)
		}
	case <-time.After(5 * time.Second):
		GlobalOutputManager.mutex.Lock()
		delete(GlobalOutputManager.pendingRequests, requestID)
		GlobalOutputManager.mutex.Unlock()
		tm.logger.Warn("Request timeout for terminal output", "terminalId", terminalId, "requestID", requestID)
		return nil, fmt.Errorf("request timeout for terminal output")
	}
}

// GetTerminalOutput fetches output (200 lines) via websocket
func (tm *TerminalManager) GetTerminalOutput(terminalId string) ([]string, error) {
	return tm.RequestTerminalOutput(terminalId, 200)
}

// HandleOutputResponse processes frontend output response
func (tom *TerminalOutputManager) HandleOutputResponse(response *message.TermOutputResponse) {
	tom.mutex.RLock()
	request, exists := tom.pendingRequests[response.RequestID]
	tom.mutex.RUnlock()
	if !exists {
		return
	}
	select {
	case request.response <- response:
	default:
	}
}

// AIAgentService AI Agent version service
type AIAgentService struct {
	modelService     *ModelService
	chatStoreService *ChatStoreService
	logger           *slog.Logger
}

// NewAIAgentService creates a new AI Agent service
func NewAIAgentService(chatStoreService *ChatStoreService, modelService *ModelService) *AIAgentService {
	return &AIAgentService{
		chatStoreService: chatStoreService,
		modelService:     modelService,
		logger:           utils2.GetLogger(),
	}
}

// getChatModel selects and constructs the chat model based on provider
func (s *AIAgentService) getChatModel(c *gin.Context) (einoModel.ToolCallingChatModel, error) {
	selectedModel := c.Query("selectedModel")
	if selectedModel == "" {
		return nil, fmt.Errorf("selectedModel parameter is required")
	}
	modelConfig, err := s.modelService.GetModelConfig(selectedModel)
	if err != nil {
		return nil, fmt.Errorf("failed to get model config: %w", err)
	}
	if modelConfig == nil {
		return nil, fmt.Errorf("model not found: %s", selectedModel)
	}

	// Check if model supports chat task type
	hasChat := false
	for _, t := range modelConfig.TaskTypes {
		if t == models.TaskTypeChat {
			hasChat = true
			break
		}
	}
	if !hasChat {
		return nil, fmt.Errorf("model %s does not support chat task type", selectedModel)
	}

	ctx := context.Background()

	switch modelConfig.Provider {
	case "openai", "custom":
		chatModel, err := openai.NewChatModel(ctx, &openai.ChatModelConfig{
			BaseURL: modelConfig.BaseUrl,
			APIKey:  modelConfig.ApiKey,
			Model:   modelConfig.Model,
		})
		if err != nil {
			return nil, fmt.Errorf("failed to create OpenAI model: %w", err)
		}
		return chatModel, nil

	case "ark":
		timeout := time.Second * 600
		retries := 3
		region := ""
		if modelConfig.Extra != nil {
			if v, ok := modelConfig.Extra["region"]; ok {
				region, _ = v.(string)
			}
		}
		chatModel, err := ark.NewChatModel(ctx, &ark.ChatModelConfig{
			BaseURL:    modelConfig.BaseUrl,
			Region:     region,
			Timeout:    &timeout,
			RetryTimes: &retries,
			APIKey:     modelConfig.ApiKey,
			Model:      modelConfig.Model,
		})
		if err != nil {
			return nil, fmt.Errorf("failed to create Ark model: %w", err)
		}
		return chatModel, nil

	case "deepseek":
		chatModel, err := deepseek.NewChatModel(ctx, &deepseek.ChatModelConfig{
			BaseURL: modelConfig.BaseUrl,
			APIKey:  modelConfig.ApiKey,
			Model:   modelConfig.Model,
		})
		if err != nil {
			return nil, fmt.Errorf("failed to create DeepSeek model: %w", err)
		}
		return chatModel, nil

	case "anthropic":
		chatModel, err := claude.NewChatModel(ctx, &claude.Config{
			BaseURL:   &modelConfig.BaseUrl,
			APIKey:    modelConfig.ApiKey,
			Model:     modelConfig.Model,
			MaxTokens: 8192,
		})
		if err != nil {
			return nil, fmt.Errorf("failed to create Claude model: %w", err)
		}
		return chatModel, nil

	case "ollama":
		chatModel, err := ollama.NewChatModel(ctx, &ollama.ChatModelConfig{
			BaseURL: modelConfig.BaseUrl,
			Model:   modelConfig.Model,
		})
		if err != nil {
			return nil, fmt.Errorf("failed to create Ollama model: %w", err)
		}
		return chatModel, nil

	case "google":
		genaiClient, err := genai.NewClient(ctx, &genai.ClientConfig{
			APIKey:  modelConfig.ApiKey,
			Backend: genai.BackendGeminiAPI,
		})
		if err != nil {
			return nil, fmt.Errorf("failed to create Gemini client: %w", err)
		}
		chatModel, err := gemini.NewChatModel(ctx, &gemini.Config{
			Client: genaiClient,
			Model:  modelConfig.Model,
		})
		if err != nil {
			return nil, fmt.Errorf("failed to create Gemini model: %w", err)
		}
		return chatModel, nil

	case "qianfan":
		qianfanConfig := qianfan.GetQianfanSingletonConfig()
		qianfanConfig.BaseURL = modelConfig.BaseUrl
		qianfanConfig.BearerToken = modelConfig.ApiKey
		chatModel, err := qianfan.NewChatModel(ctx, &qianfan.ChatModelConfig{
			Model: modelConfig.Model,
		})
		if err != nil {
			return nil, fmt.Errorf("failed to create Qianfan model: %w", err)
		}
		return chatModel, nil

	case "qwen":
		chatModel, err := qwen.NewChatModel(ctx, &qwen.ChatModelConfig{
			BaseURL: modelConfig.BaseUrl,
			APIKey:  modelConfig.ApiKey,
			Model:   modelConfig.Model,
		})
		if err != nil {
			return nil, fmt.Errorf("failed to create Qwen model: %w", err)
		}
		return chatModel, nil

	default:
		return nil, fmt.Errorf("unsupported model provider: %s", modelConfig.Provider)
	}
}

func (s *AIAgentService) getAgent(c *gin.Context, tools []tool.BaseTool) (*adk.ChatModelAgent, error) {
	model, err := s.getChatModel(c)
	if err != nil {
		return nil, err
	}
	// System prompt template
	systemPrompt := `You are a professional terminal assistant that helps users solve command line related issues.

LANGUAGE RULE (CRITICAL):
- Always respond in the SAME language the user uses
- If user writes in Chinese, respond in Chinese
- If user writes in English, respond in English
- If user writes in other languages, respond in that language
- This rule overrides all other instructions

Your capabilities include:
1. Analyze terminal output and error messages
2. Execute commands and obtain their output & exit code
3. Provide command line solutions
4. Interpret command execution results
5. Assist diagnosing system issues

When user asks about terminal or command related issues you can:
- Use terminal_get_output to view recent output of a specific terminal
- Use terminal_exec_command to run commands (only safe, user-intended, scoped operations; ask for confirmation for risky ones)
- Use terminal_read_file and terminal_write_file to read/write files if needed for diagnosis
- Analyze results and error messages
- Provide concrete solution suggestions

Important notes:
- When user message contains "Current Terminal ID:" prefer that ID for tool calls
- When user message contains "Available Terminal List:" you may pick one or more IDs as needed
- Terminal IDs often look like "hostxxx" or concrete identifiers
- If user asks about a specific terminal, prioritize current terminal ID
- For continuous output retrieval: execute command first, then call terminal_get_output if needed
- Risky commands (deleting data, modifying system configs) must include a risk warning and ask for confirmation before execution

CRITICAL JSON ARGUMENT RULES:
- All tool call arguments MUST be valid JSON. Escape backslashes (\\) and quotes (\") inside strings.
- Prefer single quotes in shell commands to reduce escaping needs, e.g.: grep -Er 'pattern1|pattern2' --include='*.py' .
- For grep alternation, use -E and single-quoted patterns without backslashes: 'a|b|c' (do NOT write a\|b in JSON).
- If a command needs literal backslashes, double-escape in JSON (e.g. "\\|"), or rephrase to avoid them.

Use professional and friendly language in responses.`

	agent, err := adk.NewChatModelAgent(context.TODO(), &adk.ChatModelAgentConfig{
		Name:        "Terminal Assistant",
		Description: "An agent that can solve terminal and command line related issues",
		Instruction: systemPrompt,
		Model:       model,
		ToolsConfig: adk.ToolsConfig{ToolsNodeConfig: compose.ToolsNodeConfig{Tools: tools}},
	})
	if err != nil {
		return nil, fmt.Errorf("failed to create chat model agent: %w", err)
	}
	return agent, nil
}

// SSEEvent sends a single SSE event
func (s *AIAgentService) SSEEvent(c *gin.Context, event string, data any) {
	flusher, _ := c.Writer.(http.Flusher)
	_, _ = c.Writer.WriteString(fmt.Sprintf("event: %s\n", event))
	payload, _ := json.Marshal(data)
	_, _ = c.Writer.WriteString(fmt.Sprintf("data: %s\n\n", string(payload)))
	flusher.Flush()
}

// LogMessages logs messages for debugging
func (s *AIAgentService) LogMessages(key string, msgs []*schema.Message) {
	text, err := json.MarshalIndent(msgs, "", "  ")
	if err != nil {
		s.logger.Error("Failed to marshal messages for log", "error", err)
	}
	s.logger.Debug("Chat messages", "key", key, "messages", string(text))
}

// sanitizeMessages cleans up history messages to ensure API compatibility
// It handles:
// 1. Merging consecutive messages with the same role
// 2. Removing incomplete tool_calls (without corresponding tool responses)
// 3. Ensuring assistant messages have non-empty content when needed
// 4. Clearing reasoning_content as most models don't support it
// 5. Converting tool messages to user messages for API compatibility
func (s *AIAgentService) sanitizeMessages(messages []*schema.Message) []*schema.Message {
	if len(messages) == 0 {
		return messages
	}

	// First pass: build a map of tool_call ID -> tool response content
	toolResponses := make(map[string]string)
	for _, msg := range messages {
		if msg.Role == schema.Tool && msg.ToolCallID != "" {
			toolResponses[msg.ToolCallID] = msg.Content
		}
	}

	// Second pass: process messages, inline tool responses into assistant messages
	processed := make([]*schema.Message, 0, len(messages))
	for _, msg := range messages {
		if msg == nil {
			continue
		}

		// Skip tool messages - we'll inline them into the assistant message
		if msg.Role == schema.Tool {
			continue
		}

		// Create a copy to avoid modifying original
		msgCopy := *msg

		// Clear reasoning_content as most models don't support it
		msgCopy.ReasoningContent = ""

		// Handle assistant messages with tool_calls
		if msgCopy.Role == schema.Assistant && len(msgCopy.ToolCalls) > 0 {
			// Build content that includes tool call results
			var contentParts []string
			if msgCopy.Content != "" {
				contentParts = append(contentParts, msgCopy.Content)
			}

			hasValidToolCalls := false
			for _, tc := range msgCopy.ToolCalls {
				if response, ok := toolResponses[tc.ID]; ok {
					hasValidToolCalls = true
					// Include tool call info and response in content
					toolInfo := fmt.Sprintf("[Tool: %s]\nResult: %s", tc.Function.Name, response)
					contentParts = append(contentParts, toolInfo)
				}
			}

			// Clear tool_calls since we've inlined the results
			msgCopy.ToolCalls = nil

			// Update content with tool results
			if len(contentParts) > 0 {
				msgCopy.Content = strings.Join(contentParts, "\n\n")
			}

			// Skip if no content after processing
			if msgCopy.Content == "" && !hasValidToolCalls {
				continue
			}
		}

		// Skip empty assistant messages
		if msgCopy.Role == schema.Assistant && msgCopy.Content == "" {
			continue
		}

		processed = append(processed, &msgCopy)
	}

	// Third pass: merge consecutive same-role messages
	result := make([]*schema.Message, 0, len(processed))
	for _, msg := range processed {
		// Try to merge with last message if same role
		if len(result) > 0 {
			lastMsg := result[len(result)-1]
			if lastMsg.Role == msg.Role {
				// Merge content
				if msg.Content != "" {
					if lastMsg.Content != "" {
						lastMsg.Content = lastMsg.Content + "\n" + msg.Content
					} else {
						lastMsg.Content = msg.Content
					}
				}
				continue
			}
		}

		result = append(result, msg)
	}

	return result
}

// HandleAgentChat processes agent chat requests
func (s *AIAgentService) HandleAgentChat(c *gin.Context) {
	// ...existing validation & setup code...
	stageId := int64(0)
	newStage := func() int64 { stageId += 1; return stageId }

	// Parse body before setting SSE headers
	var req api.ChatRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		s.logger.Error("Invalid request format", "error", err)
		c.JSON(http.StatusBadRequest, gin.H{"error": fmt.Sprintf("Invalid request format: %s", err.Error())})
		return
	}

	selectedModel := c.Query("selectedModel")
	if selectedModel == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "selectedModel parameter is required"})
	}

	if req.ConversationID == "" {
		s.logger.Error("Conversation ID is required")
		c.JSON(http.StatusBadRequest, gin.H{"error": "Conversation ID is required"})
		return
	}

	chatStore := s.chatStoreService

	agentMode := c.Query("agentMode")
	if agentMode != "tools" && agentMode != "react" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Agent mode is invalid"})
	}

	_, ok := c.Writer.(http.Flusher)
	if !ok {
		s.logger.Error("Streaming not supported")
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Streaming not supported"})
		return
	}

	tools := []tool.BaseTool{NewTerminalOutputTool(), NewExecCommandTool(), NewWriteFileTool(), NewReadFileTool()}

	// Set SSE headers
	c.Header("Content-Type", "text/event-stream")
	c.Header("Cache-Control", "no-cache")
	c.Header("Connection", "keep-alive")
	c.Header("Access-Control-Allow-Origin", "*")
	c.Header("Access-Control-Allow-Methods", "POST, OPTIONS")
	c.Header("Access-Control-Allow-Headers", "Content-Type")

	s.SSEEvent(c, "connected", map[string]string{"time": time.Now().Format(time.RFC3339)})

	messages := make([]*schema.Message, 0)

	// Load history
	historyMessages, err := chatStore.GetSchemaMessages(req.ConversationID, req.ParentID)
	if err != nil {
		s.logger.Error("Failed to get history messages", "error", err)
		s.SSEEvent(c, "error", map[string]string{"error": fmt.Sprintf("Failed to get history messages: %s", err.Error())})
		return
	}
	s.LogMessages("history message of conversation id "+req.ConversationID, historyMessages)
	// Sanitize history messages to ensure API compatibility
	historyMessages = s.sanitizeMessages(historyMessages)
	s.LogMessages("sanitized history messages", historyMessages)
	messages = append(messages, historyMessages...)

	// Save user message
	err = chatStore.CreateMessage(req.ConversationID, req.MessageID, req.ParentID, string(schema.User))
	if err != nil {
		s.logger.Error("Failed to save user message", "error", err)
		s.SSEEvent(c, "error", map[string]string{"error": fmt.Sprintf("Failed to save message: %s", err.Error())})
	}
	err = chatStore.AppendMessageContentFromSchema(req.MessageID, &req.Message)
	if err != nil {
		s.logger.Error("Failed to save user message", "error", err)
		s.SSEEvent(c, "error", map[string]string{"error": fmt.Sprintf("Failed to save message: %s", err.Error())})
		return
	}

	replyId := uuid.New().String()
	err = chatStore.CreateMessage(req.ConversationID, replyId, req.MessageID, string(schema.Assistant))
	if err != nil {
		s.logger.Error("Failed to create assistant message", "error", err)
		s.SSEEvent(c, "error", map[string]string{"error": fmt.Sprintf("Failed to create assistant message: %s", err.Error())})
		return
	}

	userMessage := req.Message
	// Add terminal context
	terminalContext := s.buildTerminalContextForMessage(c)
	if terminalContext != "" {
		userMessage.Content = terminalContext + "\n\nUser Message:" + req.Message.Content
	}

	messages = append(messages, &userMessage)

	if agentMode == "tools" {
		// Build tool-enabled model
		toolsInfo := make([]*schema.ToolInfo, 0)
		for _, toolItem := range tools {
			info, err := toolItem.Info(context.TODO())
			if err != nil {
				s.logger.Error("Failed to get tool info", "error", err)
				continue
			}
			toolsInfo = append(toolsInfo, info)
		}

		chatModel, err := s.getChatModel(c)
		if err != nil {
			s.SSEEvent(c, "error", map[string]string{"error": fmt.Sprintf("Failed to create chat model: %s", err.Error())})
			return
		}
		toolsModel, err := chatModel.WithTools(toolsInfo)
		if err != nil {
			s.SSEEvent(c, "error", map[string]string{"error": fmt.Sprintf("Failed to create tools model: %s", err.Error())})
			return
		}

		// Start streaming
		reader, err := toolsModel.Stream(c.Request.Context(), messages)
		if err != nil {
			s.SSEEvent(c, "error", map[string]string{"error": fmt.Sprintf("Failed to start streaming: %s", err.Error())})
			return
		}

		newStage()
		chunks := make([]*schema.Message, 0)
		for {
			chunk, err := reader.Recv()
			if errors.Is(err, io.EOF) {
				break
			}
			if err != nil {
				s.SSEEvent(c, "error", map[string]string{"error": fmt.Sprintf("Failed to start streaming: %s", err.Error())})
				return
			}
			chunks = append(chunks, chunk)
			// Send chunk to client if it has content and no tool calls
			// Note: only the first chunk typically has Role set, subsequent chunks may have empty Role
			if chunk.ToolCalls == nil && (chunk.Content != "" || chunk.Role != "" || chunk.ReasoningContent != "") {
				chatResponse := &api.ChatResponse{ConversationID: req.ConversationID, MessageID: replyId, ParentID: req.MessageID, Message: *chunk}
				s.SSEEvent(c, "message", chatResponse)
			}
		}

		aiMessage, err := schema.ConcatMessages(chunks)
		if err != nil {
			s.SSEEvent(c, "error", map[string]string{"error": fmt.Sprintf("Failed to concat messages: %s", err.Error())})
			return
		}
		s.LogMessages("messages stage 1", messages)
		err = chatStore.AppendMessageContentFromSchema(replyId, aiMessage)
		if err != nil {
			s.logger.Error("Failed to save AI message", "error", err)
			s.SSEEvent(c, "error", map[string]string{"error": fmt.Sprintf("Failed to save AI message: %s", err.Error())})
		}
		messages = append(messages, aiMessage)

		if len(aiMessage.ToolCalls) > 0 {
			s.LogMessages("tools start messages", []*schema.Message{aiMessage})
			toolStartMessage := &api.ChatResponse{ConversationID: req.ConversationID, MessageID: replyId, ParentID: req.MessageID, Message: *aiMessage}
			s.SSEEvent(c, "message", toolStartMessage)

			tools, err := compose.NewToolNode(context.Background(), &compose.ToolsNodeConfig{Tools: tools})
			if err != nil {
				s.SSEEvent(c, "error", map[string]string{"error": fmt.Sprintf("Failed to create tools node: %s", err.Error())})
				return
			}

			toolResultMessage, err := tools.Invoke(c.Request.Context(), aiMessage)
			if err != nil {
				s.logger.Error("Failed to invoke tools node", "error", err)
				s.SSEEvent(c, "error", map[string]string{"error": fmt.Sprintf("Tool execution failed: %s", err.Error())})
				return
			}
			s.LogMessages("tools result messages", toolResultMessage)

			for _, msg := range toolResultMessage {
				err = chatStore.AppendMessageContentFromSchema(replyId, msg)
				if err != nil {
					s.logger.Error("Failed to save tool result message", "error", err)
					s.SSEEvent(c, "error", map[string]string{"error": fmt.Sprintf("Failed to save tool result message: %s", err.Error())})
				}
			}

			newStage()
			for _, msg := range toolResultMessage {
				toolMsg := &api.ChatResponse{ConversationID: req.ConversationID, MessageID: replyId, ParentID: req.MessageID, Message: *msg}
				s.SSEEvent(c, "message", toolMsg)
			}

			messages = append(messages, toolResultMessage...)

			messages = append(messages, &schema.Message{Role: "user", Content: "Based on all above information, provide the final complete answer. No more tool calls needed."})
			finalReader, err := toolsModel.Stream(c.Request.Context(), messages)
			if err != nil {
				s.SSEEvent(c, "error", map[string]string{"error": fmt.Sprintf("Failed to start final response stream: %s", err.Error())})
				return
			}

			newStage()
			finalChunks := make([]*schema.Message, 0)
			for {
				chunk, err := finalReader.Recv()
				if errors.Is(err, io.EOF) {
					break
				}
				if err != nil {
					s.SSEEvent(c, "error", map[string]string{"error": fmt.Sprintf("Final stream error: %s", err.Error())})
					break
				}
				finalChunks = append(finalChunks, chunk)
				// Send chunk to client if it has content
				if chunk.Content != "" || chunk.Role != "" || chunk.ReasoningContent != "" {
					chatResponse := &api.ChatResponse{ConversationID: req.ConversationID, MessageID: replyId, ParentID: req.MessageID, Message: *chunk}
					s.SSEEvent(c, "message", chatResponse)
				}
			}

			finalMessage, err := schema.ConcatMessages(finalChunks)
			if err != nil {
				s.logger.Error("Failed to concat final messages", "error", err)
			}
			s.LogMessages("final message", []*schema.Message{finalMessage})
			err = chatStore.AppendMessageContentFromSchema(replyId, finalMessage)
			if err != nil {
				s.logger.Error("Failed to save final message", "error", err)
				s.SSEEvent(c, "error", map[string]string{"error": fmt.Sprintf("Failed to save final message: %s", err.Error())})
			}
		}

		s.SSEEvent(c, "completed", map[string]string{"message": "Message processing completed"})
	} else if agentMode == "react" {
		agent, err := s.getAgent(c, tools)
		if err != nil {
			s.SSEEvent(c, "error", map[string]string{"error": fmt.Sprintf("Failed to get agent: %s", err.Error())})
			return
		}
		iter := agent.Run(c.Request.Context(), &adk.AgentInput{Messages: messages, EnableStreaming: true})
		for {
			newStage()
			part, ok := iter.Next()
			if !ok {
				break
			}
			if part.Err != nil {
				s.logger.Error("Agent iteration error", "error", part.Err)
				s.SSEEvent(c, "error", map[string]string{"error": fmt.Sprintf("Agent error: %s", part.Err.Error())})
				break
			}

			chunks := make([]*schema.Message, 0)
			if part.Output.MessageOutput.MessageStream != nil {
				for {
					chunk, err := part.Output.MessageOutput.MessageStream.Recv()
					if errors.Is(err, io.EOF) {
						break
					}
					if err != nil {
						s.logger.Error("Agent stream iteration error", "error", err)
						s.SSEEvent(c, "error", map[string]string{"error": fmt.Sprintf("Stream error: %s", err.Error())})
						break
					}
					chunks = append(chunks, chunk)
					s.logger.Debug("Agent stream iteration", "message", chunk)
					// Send chunk to client if it has content and no tool calls
					if chunk.ToolCalls == nil && (chunk.Content != "" || chunk.Role != "" || chunk.ReasoningContent != "") {
						s.SSEEvent(c, "message", &api.ChatResponse{ConversationID: req.ConversationID, MessageID: replyId, ParentID: req.MessageID, Message: *chunk})
					}
				}
			}

			msg, err := schema.ConcatMessages(chunks)
			if err != nil {
				s.logger.Error("Failed to concat agent messages", "error", err)
				s.SSEEvent(c, "error", map[string]string{"error": fmt.Sprintf("Failed to concat messages: %s", err.Error())})
				break
			}
			err = chatStore.AppendMessageContentFromSchema(replyId, msg)
			if err != nil {
				s.logger.Error("Failed to save agent message", "error", err)
				s.SSEEvent(c, "error", map[string]string{"error": fmt.Sprintf("Failed to save agent message: %s", err.Error())})
			}
			if len(msg.ToolCalls) > 0 {
				s.LogMessages("agent tool calls", []*schema.Message{msg})
				toolStartMessage := &api.ChatResponse{ConversationID: req.ConversationID, MessageID: replyId, ParentID: req.MessageID, Message: *msg}
				s.SSEEvent(c, "message", toolStartMessage)
			}

			msg, err = part.Output.MessageOutput.GetMessage()
			s.logger.Debug("Agent part output message", "message", msg, "error", err)
			if err != nil {
				s.logger.Warn("Failed to get assistant message", "error", err)
				s.SSEEvent(c, "error", map[string]string{"error": fmt.Sprintf("Failed to get assistant message: %s", err.Error())})
				break
			}
			s.SSEEvent(c, "message", &api.ChatResponse{ConversationID: req.ConversationID, MessageID: replyId, ParentID: req.MessageID, Message: *msg})
		}
		s.SSEEvent(c, "completed", map[string]string{"message": "Message processing completed"})
	}
}

// buildTerminalContextForMessage builds terminal context header for message
func (s *AIAgentService) buildTerminalContextForMessage(c *gin.Context) string {
	var contextParts []string

	if c.Query("currentTerminal") != "" && c.Query("currentTerminal") != "welcome" {
		contextParts = append(contextParts, fmt.Sprintf("Current Terminal ID: %s", c.Query("currentTerminal")))
	}

	if c.Query("selectedTerminals") != "" {
		selectedTerminals := strings.Split(c.Query("selectedTerminals"), ",")
		validTerminals := make([]string, 0)
		for _, terminalID := range selectedTerminals {
			if terminalID != "" && terminalID != "welcome" {
				validTerminals = append(validTerminals, terminalID)
			}
		}
		if len(validTerminals) > 0 {
			contextParts = append(contextParts, fmt.Sprintf("Available Terminal List: %s", strings.Join(validTerminals, ", ")))
		}
	}

	if len(contextParts) > 0 {
		header := "Terminal Info:\n"
		footer := "\n\nIf you need to view terminal output, use terminal_get_output tool and select one terminal ID above as terminal_id parameter."
		return header + strings.Join(contextParts, "\n") + footer
	}
	return ""
}

// AppendOutput appends terminal output
func (tm *TerminalManager) AppendOutput(sessionID, output string) {
	tm.mutex.RLock()
	session, exists := tm.terminals[sessionID]
	tm.mutex.RUnlock()
	if !exists {
		return
	}
	session.mutex.Lock()
	defer session.mutex.Unlock()
	session.Output = append(session.Output, output)
	// Keep recent output (capped large buffer)
	if len(session.Output) > 1000000 {
		session.Output = session.Output[len(session.Output)-1000000:]
	}
}

// SetLastCommand sets last executed command
func (tm *TerminalManager) SetLastCommand(sessionID, cmd string) {
	tm.mutex.RLock()
	session, exists := tm.terminals[sessionID]
	tm.mutex.RUnlock()
	if !exists {
		return
	}
	session.mutex.Lock()
	defer session.mutex.Unlock()
	session.LastCmd = cmd
}

// GetLastCommand gets last executed command
func (tm *TerminalManager) GetLastCommand(sessionID string) string {
	tm.mutex.RLock()
	session, exists := tm.terminals[sessionID]
	tm.mutex.RUnlock()
	if !exists {
		return ""
	}
	session.mutex.RLock()
	defer session.mutex.RUnlock()
	return session.LastCmd
}

// MigrateSession migrates session data to a new session ID
func (tm *TerminalManager) MigrateSession(oldSessionID, newSessionID, assetID string, conn *websocket.Conn) {
	tm.mutex.Lock()
	defer tm.mutex.Unlock()
	oldSession, exists := tm.terminals[oldSessionID]
	if exists {
		tm.terminals[newSessionID] = &TerminalSession{ID: newSessionID, AssetID: assetID, Output: oldSession.Output, LastCmd: oldSession.LastCmd, mutex: sync.RWMutex{}, conn: conn, term: oldSession.term}
		delete(tm.terminals, oldSessionID)
		tm.logger.Info("Migrated session data", "oldSessionID", oldSessionID, "newSessionID", newSessionID)
	} else {
		tm.terminals[newSessionID] = &TerminalSession{ID: newSessionID, AssetID: assetID, Output: make([]string, 0), LastCmd: "", mutex: sync.RWMutex{}, conn: conn}
		tm.logger.Info("Created new session", "sessionID", newSessionID, "assetID", assetID)
	}
}

// GenerateTitle generates a conversation title via AI model selection
func (s *AIAgentService) GenerateTitle(c *gin.Context) {
	conversationID := c.Param("id")
	chatModel, err := s.getChatModel(c)
	if err != nil {
		s.logger.Error("Failed to create chat model", "error", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create chat model"})
		return
	}
	messages, err := s.chatStoreService.GetSchemaMessages(conversationID, "")
	if err != nil {
		s.logger.Error("Failed to get conversation messages", "error", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to get conversation messages"})
		return
	}
	if len(messages) > 4 {
		messages = messages[:4]
	}
	messages = append(messages, &schema.Message{Role: schema.User, Content: "Please generate a concise accurate title for the above dialogue, plain text only"})
	output, err := chatModel.Generate(c.Request.Context(), messages)
	if err != nil {
		s.logger.Error("Failed to generate title", "error", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to generate title"})
		return
	}
	title := strings.TrimSpace(output.Content)
	if len(title) == 0 {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Empty title"})
	}
	err = s.chatStoreService.UpdateConversationTitle(conversationID, title)
	if err != nil {
		s.logger.Error("Failed to update conversation title", "error", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update conversation title"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"title": title})
}
