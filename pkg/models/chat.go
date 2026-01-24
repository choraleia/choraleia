// OpenAI-compatible API types for chat completion
package models

import (
	"github.com/choraleia/choraleia/pkg/db"
)

// ========== Type aliases for database types ==========
// These allow other packages to use models.Message instead of db.Message

type Conversation = db.Conversation
type Message = db.Message
type MessageChunk = db.MessageChunk
type MessageChunks = db.MessageChunks
type ToolCallChunk = db.ToolCallChunk
type ToolResultChunk = db.ToolResultChunk

// ========== Constant aliases from db package ==========

// MessageChunk type constants
const (
	ChunkTypeText       = db.ChunkTypeText
	ChunkTypeReasoning  = db.ChunkTypeReasoning
	ChunkTypeToolCall   = db.ChunkTypeToolCall
	ChunkTypeToolResult = db.ChunkTypeToolResult
	ChunkTypeImageURL   = db.ChunkTypeImageURL
	ChunkTypeAudioURL   = db.ChunkTypeAudioURL
	ChunkTypeVideoURL   = db.ChunkTypeVideoURL
	ChunkTypeFileURL    = db.ChunkTypeFileURL
)

// Message status constants
const (
	MessageStatusPending   = db.MessageStatusPending
	MessageStatusStreaming = db.MessageStatusStreaming
	MessageStatusCompleted = db.MessageStatusCompleted
	MessageStatusError     = db.MessageStatusError
)

// Conversation status constants
const (
	ConversationStatusActive   = db.ConversationStatusActive
	ConversationStatusArchived = db.ConversationStatusArchived
)

// ========== OpenAI-compatible API types ==========

// ChatCompletionRequest represents an OpenAI-compatible chat completion request
type ChatCompletionRequest struct {
	Model            string                  `json:"model,omitempty"`
	Messages         []ChatCompletionMessage `json:"messages"`
	Stream           bool                    `json:"stream,omitempty"`
	Temperature      *float64                `json:"temperature,omitempty"`
	TopP             *float64                `json:"top_p,omitempty"`
	MaxTokens        *int                    `json:"max_tokens,omitempty"`
	N                *int                    `json:"n,omitempty"`                   // Number of completions to generate
	Stop             []string                `json:"stop,omitempty"`                // Stop sequences
	PresencePenalty  *float64                `json:"presence_penalty,omitempty"`    // -2.0 to 2.0
	FrequencyPenalty *float64                `json:"frequency_penalty,omitempty"`   // -2.0 to 2.0
	LogitBias        map[string]float64      `json:"logit_bias,omitempty"`          // Token bias
	LogProbs         *bool                   `json:"logprobs,omitempty"`            // Return log probabilities
	TopLogProbs      *int                    `json:"top_logprobs,omitempty"`        // Number of top logprobs to return
	User             string                  `json:"user,omitempty"`                // End-user identifier
	Seed             *int64                  `json:"seed,omitempty"`                // Random seed for determinism
	Tools            []ChatCompletionTool    `json:"tools,omitempty"`               // Available tools
	ToolChoice       interface{}             `json:"tool_choice,omitempty"`         // "auto", "none", "required", or specific tool
	ParallelToolCall *bool                   `json:"parallel_tool_calls,omitempty"` // Allow parallel tool calls
	ResponseFormat   *ResponseFormat         `json:"response_format,omitempty"`     // Response format specification
	StreamOptions    *StreamOptions          `json:"stream_options,omitempty"`      // Stream options

	// Extended fields (non-OpenAI standard)
	ConversationID string `json:"conversation_id,omitempty"` // Existing conversation to continue
	WorkspaceID    string `json:"workspace_id,omitempty"`    // Workspace context
	RoomID         string `json:"room_id,omitempty"`         // Optional room context
	AgentID        string `json:"agent_id,omitempty"`        // WorkspaceAgent ID to use (empty = default chat model agent)

	// Branch support
	ParentID string `json:"parent_id,omitempty"` // Parent message ID for branching
	SourceID string `json:"source_id,omitempty"` // Original message being edited/regenerated
	Action   string `json:"action,omitempty"`    // "new" (default), "edit", "regenerate"
}

// ResponseFormat specifies the format of the response
type ResponseFormat struct {
	Type       string      `json:"type,omitempty"`        // "text", "json_object", "json_schema"
	JSONSchema *JSONSchema `json:"json_schema,omitempty"` // JSON schema specification
}

// JSONSchema for structured outputs
type JSONSchema struct {
	Name        string      `json:"name"`
	Description string      `json:"description,omitempty"`
	Schema      interface{} `json:"schema,omitempty"` // JSON Schema object
	Strict      *bool       `json:"strict,omitempty"`
}

// StreamOptions for streaming configuration
type StreamOptions struct {
	IncludeUsage bool `json:"include_usage,omitempty"` // Include usage in stream
}

// ChatCompletionMessage represents a message in the request/response
type ChatCompletionMessage struct {
	Role             string      `json:"role"`
	Content          interface{} `json:"content,omitempty"`           // Can be string or array of content parts
	Name             string      `json:"name,omitempty"`              // Optional sender name
	ToolCalls        []ToolCall  `json:"tool_calls,omitempty"`        // For assistant messages with tool calls
	ToolCallID       string      `json:"tool_call_id,omitempty"`      // For tool response messages
	Refusal          string      `json:"refusal,omitempty"`           // Refusal message if any
	ReasoningContent string      `json:"reasoning_content,omitempty"` // Extended: thinking process
}

// ContentPart represents a part of multi-modal content
type ContentPart struct {
	Type       string      `json:"type"`                  // "text", "image_url", "input_audio"
	Text       string      `json:"text,omitempty"`        // For text type
	ImageURL   *ImageURL   `json:"image_url,omitempty"`   // For image_url type
	InputAudio *InputAudio `json:"input_audio,omitempty"` // For input_audio type
}

// ImageURL for image content
type ImageURL struct {
	URL    string `json:"url"`              // URL or base64 data URI
	Detail string `json:"detail,omitempty"` // "auto", "low", "high"
}

// InputAudio for audio content
type InputAudio struct {
	Data   string `json:"data"`   // Base64 encoded audio data
	Format string `json:"format"` // "wav", "mp3"
}

// ToolCall represents a tool call in OpenAI format
type ToolCall struct {
	Index    *int         `json:"index,omitempty"` // Index for streaming
	ID       string       `json:"id"`
	Type     string       `json:"type"` // "function"
	Function FunctionCall `json:"function"`
}

// FunctionCall represents a function call
type FunctionCall struct {
	Name      string `json:"name"`
	Arguments string `json:"arguments"` // JSON string
}

// ChatCompletionTool represents a tool definition
type ChatCompletionTool struct {
	Type     string                     `json:"type"` // "function"
	Function ChatCompletionToolFunction `json:"function"`
}

// ChatCompletionToolFunction represents a function tool definition
type ChatCompletionToolFunction struct {
	Name        string      `json:"name"`
	Description string      `json:"description,omitempty"`
	Parameters  interface{} `json:"parameters,omitempty"` // JSON Schema
	Strict      *bool       `json:"strict,omitempty"`     // Enable strict mode
}

// ChatCompletionResponse represents an OpenAI-compatible chat completion response
type ChatCompletionResponse struct {
	ID                string                 `json:"id"`
	Object            string                 `json:"object"` // "chat.completion"
	Created           int64                  `json:"created"`
	Model             string                 `json:"model"`
	Choices           []ChatCompletionChoice `json:"choices"`
	Usage             *TokenUsage            `json:"usage,omitempty"`
	SystemFingerprint string                 `json:"system_fingerprint,omitempty"`
	ServiceTier       string                 `json:"service_tier,omitempty"` // Service tier used

	// Extended field
	ConversationID string `json:"conversation_id,omitempty"`
}

// ChatCompletionChoice represents a choice in the response
type ChatCompletionChoice struct {
	Index        int                   `json:"index"`
	Message      ChatCompletionMessage `json:"message"`
	FinishReason string                `json:"finish_reason,omitempty"` // stop, tool_calls, length, content_filter
	LogProbs     *LogProbs             `json:"logprobs,omitempty"`      // Log probability information
}

// LogProbs contains log probability information
type LogProbs struct {
	Content []TokenLogProb `json:"content,omitempty"`
	Refusal []TokenLogProb `json:"refusal,omitempty"`
}

// TokenLogProb represents log probability for a token
type TokenLogProb struct {
	Token       string       `json:"token"`
	LogProb     float64      `json:"logprob"`
	Bytes       []int        `json:"bytes,omitempty"`
	TopLogProbs []TopLogProb `json:"top_logprobs,omitempty"`
}

// TopLogProb represents a top log probability candidate
type TopLogProb struct {
	Token   string  `json:"token"`
	LogProb float64 `json:"logprob"`
	Bytes   []int   `json:"bytes,omitempty"`
}

// TokenUsage represents token usage statistics
type TokenUsage struct {
	PromptTokens            int                      `json:"prompt_tokens"`
	CompletionTokens        int                      `json:"completion_tokens"`
	TotalTokens             int                      `json:"total_tokens"`
	PromptTokensDetails     *PromptTokensDetails     `json:"prompt_tokens_details,omitempty"`
	CompletionTokensDetails *CompletionTokensDetails `json:"completion_tokens_details,omitempty"`
}

// PromptTokensDetails provides detailed prompt token breakdown
type PromptTokensDetails struct {
	CachedTokens int `json:"cached_tokens,omitempty"`
	AudioTokens  int `json:"audio_tokens,omitempty"`
}

// CompletionTokensDetails provides detailed completion token breakdown
type CompletionTokensDetails struct {
	ReasoningTokens          int `json:"reasoning_tokens,omitempty"`
	AudioTokens              int `json:"audio_tokens,omitempty"`
	AcceptedPredictionTokens int `json:"accepted_prediction_tokens,omitempty"`
	RejectedPredictionTokens int `json:"rejected_prediction_tokens,omitempty"`
}

// ========== Streaming types ==========

// ChatCompletionChunk represents a streaming chunk (OpenAI-compatible)
type ChatCompletionChunk struct {
	ID                string                      `json:"id"`
	Object            string                      `json:"object"` // "chat.completion.chunk"
	Created           int64                       `json:"created"`
	Model             string                      `json:"model"`
	Choices           []ChatCompletionChunkChoice `json:"choices"`
	Usage             *TokenUsage                 `json:"usage,omitempty"` // Only when stream_options.include_usage is true
	SystemFingerprint string                      `json:"system_fingerprint,omitempty"`
	ServiceTier       string                      `json:"service_tier,omitempty"`

	// Extended field
	ConversationID string `json:"conversation_id,omitempty"`
}

// ChatCompletionChunkChoice represents a choice in a streaming chunk
type ChatCompletionChunkChoice struct {
	Index        int                      `json:"index"`
	Delta        ChatCompletionChunkDelta `json:"delta"`
	FinishReason string                   `json:"finish_reason,omitempty"`
	LogProbs     *LogProbs                `json:"logprobs,omitempty"`
}

// ChatCompletionChunkDelta represents the delta content in a streaming chunk
type ChatCompletionChunkDelta struct {
	Role             string     `json:"role,omitempty"`
	Content          string     `json:"content,omitempty"`
	ToolCalls        []ToolCall `json:"tool_calls,omitempty"`
	ToolCallID       string     `json:"tool_call_id,omitempty"`
	Refusal          string     `json:"refusal,omitempty"`
	ReasoningContent string     `json:"reasoning_content,omitempty"` // Extended
	AgentName        string     `json:"agent_name,omitempty"`        // Extended: current agent name
}

// ========== Constants ==========

// Message roles (OpenAI standard)
const (
	RoleUser      = "user"
	RoleAssistant = "assistant"
	RoleSystem    = "system"
	RoleTool      = "tool"
)

// Finish reasons (OpenAI standard)
const (
	FinishReasonStop          = "stop"
	FinishReasonToolCalls     = "tool_calls"
	FinishReasonLength        = "length"
	FinishReasonContentFilter = "content_filter"
	FinishReasonError         = "error"       // Extended
	FinishReasonCancelled     = "cancelled"   // Extended: user cancelled
	FinishReasonInterrupted   = "interrupted" // Extended: service restart/unexpected termination
)

// ========== Conversation API types ==========

// CreateConversationRequest represents a request to create a conversation
type CreateConversationRequest struct {
	Title       string `json:"title,omitempty"`
	WorkspaceID string `json:"workspace_id"`
	RoomID      string `json:"room_id,omitempty"`
}

// UpdateConversationRequest represents a request to update a conversation
type UpdateConversationRequest struct {
	Title  string `json:"title,omitempty"`
	Status string `json:"status,omitempty"`
}

// ConversationListResponse represents the response for listing conversations
type ConversationListResponse struct {
	Conversations []Conversation `json:"conversations"`
	HasMore       bool           `json:"has_more"`
}
