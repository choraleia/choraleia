// Database models for chat messages
package db

import (
	"database/sql/driver"
	"encoding/json"
	"time"
)

// Message represents a chat message (OpenAI-compatible format)
// One Message.ID = one complete message visible to user
// Chunks are stored in a separate table (message_chunks) for real-time persistence
type Message struct {
	ID             string `json:"id" gorm:"primaryKey;size:36"`
	ConversationID string `json:"conversation_id" gorm:"index;size:36;not null"`

	// Branch support - enables message tree structure
	ParentID    *string `json:"parent_id,omitempty" gorm:"index;size:36"` // Parent message ID (nil for root messages)
	BranchIndex int     `json:"branch_index" gorm:"default:0"`            // Index among siblings (0, 1, 2... for branches)

	// Core fields
	Role string `json:"role" gorm:"size:20;not null"`   // user, assistant, system
	Name string `json:"name,omitempty" gorm:"size:100"` // Optional name (OpenAI compatible, typically for user name)

	// Status and metadata
	Status       string      `json:"status" gorm:"size:20;default:'completed'"` // pending, streaming, completed, error
	FinishReason string      `json:"finish_reason,omitempty" gorm:"size:20"`    // stop, tool_calls, length, error
	Usage        *TokenUsage `json:"usage,omitempty" gorm:"type:text"`          // JSON

	// Compression-related fields
	IsCompressed bool    `json:"is_compressed" gorm:"default:false"`
	SnapshotID   *string `json:"snapshot_id,omitempty" gorm:"index;size:36"`
	TokenCount   int     `json:"token_count,omitempty"`

	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`

	// Chunks loaded from message_chunks table (not stored in this table)
	// Use gorm:"-" to exclude from database operations
	Chunks []MessageChunk `json:"-" gorm:"-"`

	// Parts is the merged/processed version of Chunks for API response
	// Consecutive text chunks are merged, consecutive reasoning chunks are merged
	// Not stored in database, populated when loading messages for API
	Parts []MessagePart `json:"parts,omitempty" gorm:"-"`
}

func (*Message) TableName() string {
	return "messages"
}

// ========== MessageChunk - Separate table for message chunks ==========

// MessageChunk type constants
const (
	ChunkTypeText       = "text"        // Text content
	ChunkTypeReasoning  = "reasoning"   // Reasoning/thinking content
	ChunkTypeToolCall   = "tool_call"   // Tool call request
	ChunkTypeToolResult = "tool_result" // Tool call result
	ChunkTypeImageURL   = "image_url"   // Image (eino compatible)
	ChunkTypeAudioURL   = "audio_url"   // Audio
	ChunkTypeVideoURL   = "video_url"   // Video
	ChunkTypeFileURL    = "file_url"    // File
)

// MessageChunk represents a single chunk of a message stored in database
// Each chunk is stored as a separate row for real-time persistence during streaming
type MessageChunk struct {
	ID        string `json:"id,omitempty" gorm:"primaryKey;size:36"`
	MessageID string `json:"message_id,omitempty" gorm:"index;size:36;not null"` // Foreign key to messages table

	// Chunk metadata
	Type       string `json:"type" gorm:"size:20;not null"`               // text, reasoning, tool_call, tool_result, image_url, etc.
	RoundIndex int    `json:"round_index" gorm:"default:0"`               // Round index for agent multi-round scenarios
	SeqIndex   int    `json:"seq_index" gorm:"default:0"`                 // Sequence index within the same round (for ordering)
	AgentName  string `json:"agent_name,omitempty" gorm:"size:100;index"` // Name of the agent that generated this chunk
	RunPath    string `json:"run_path,omitempty" gorm:"size:500"`         // Agent call path (JSON array of agent names, e.g. ["supervisor","worker1"])

	// Text content (for text, reasoning types)
	Text string `json:"text,omitempty" gorm:"type:text"`

	// Tool call fields (for tool_call type)
	ToolCallID string `json:"tool_call_id,omitempty" gorm:"size:100"`
	ToolName   string `json:"tool_name,omitempty" gorm:"size:100"`
	ToolArgs   string `json:"tool_args,omitempty" gorm:"type:text"` // JSON string

	// Tool result fields (for tool_result type)
	ToolResultContent string `json:"tool_result_content,omitempty" gorm:"type:text"`

	// Media fields (for image_url, audio_url, video_url, file_url types)
	MediaURL      string `json:"media_url,omitempty" gorm:"type:text"`
	MediaMimeType string `json:"media_mime_type,omitempty" gorm:"size:100"`
	MediaDetail   string `json:"media_detail,omitempty" gorm:"size:20"` // For image: high, low, auto
	MediaDuration int    `json:"media_duration,omitempty"`              // For audio/video: duration in seconds
	MediaName     string `json:"media_name,omitempty" gorm:"size:255"`  // For file: filename
	MediaSize     int64  `json:"media_size,omitempty"`                  // For file: size in bytes

	CreatedAt time.Time `json:"created_at,omitempty"`
}

func (*MessageChunk) TableName() string {
	return "message_chunks"
}

// ========== MessagePart - Processed/merged version of chunks for API ==========

// MessagePart represents a message part in API response (merged chunks)
type MessagePart struct {
	Type       string          `json:"type"`
	Index      int             `json:"index,omitempty"`      // Round index
	AgentName  string          `json:"agent_name,omitempty"` // Name of the agent that generated this part
	RunPath    []string        `json:"run_path,omitempty"`   // Agent call path (e.g. ["supervisor","worker1"])
	Text       string          `json:"text,omitempty"`
	ToolCall   *ToolCallPart   `json:"tool_call,omitempty"`
	ToolResult *ToolResultPart `json:"tool_result,omitempty"`
	ImageURL   *ImageURLPart   `json:"image_url,omitempty"`
	AudioURL   *AudioURLPart   `json:"audio_url,omitempty"`
	VideoURL   *VideoURLPart   `json:"video_url,omitempty"`
	FileURL    *FileURLPart    `json:"file_url,omitempty"`
}

type ToolCallPart struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	Arguments string `json:"arguments"`
}

type ToolResultPart struct {
	ToolCallID string `json:"tool_call_id"`
	Name       string `json:"name,omitempty"`
	Content    string `json:"content"`
}

type ImageURLPart struct {
	URL    string `json:"url"`
	Detail string `json:"detail,omitempty"`
}

type AudioURLPart struct {
	URL      string `json:"url"`
	MimeType string `json:"mime_type,omitempty"`
	Duration int    `json:"duration,omitempty"`
}

type VideoURLPart struct {
	URL      string `json:"url"`
	MimeType string `json:"mime_type,omitempty"`
	Duration int    `json:"duration,omitempty"`
}

type FileURLPart struct {
	URL      string `json:"url"`
	MimeType string `json:"mime_type,omitempty"`
	Name     string `json:"name,omitempty"`
	Size     int64  `json:"size,omitempty"`
}

// ========== Helper types for tool calls (used in MessageChunk) ==========

// ToolCallChunk represents a tool call in a message chunk (for JSON serialization in API)
type ToolCallChunk struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	Arguments string `json:"arguments"` // JSON string
}

// ToolResultChunk represents a tool result in a message chunk (for JSON serialization in API)
type ToolResultChunk struct {
	ToolCallID string `json:"tool_call_id"`
	Name       string `json:"name,omitempty"` // Tool name for display
	Content    string `json:"content"`
}

// ImageURL represents image content (eino compatible)
type ImageURL struct {
	URL      string `json:"url,omitempty"`
	MimeType string `json:"mime_type,omitempty"`
	Detail   string `json:"detail,omitempty"` // high, low, auto
}

// AudioURL represents audio content (eino compatible)
type AudioURL struct {
	URL      string `json:"url,omitempty"`
	MimeType string `json:"mime_type,omitempty"`
	Duration int    `json:"duration,omitempty"` // Duration in seconds
}

// VideoURL represents video content (eino compatible)
type VideoURL struct {
	URL      string `json:"url,omitempty"`
	MimeType string `json:"mime_type,omitempty"`
	Duration int    `json:"duration,omitempty"` // Duration in seconds
}

// FileURL represents file content (eino compatible)
type FileURL struct {
	URL      string `json:"url,omitempty"`
	MimeType string `json:"mime_type,omitempty"`
	Name     string `json:"name,omitempty"`
	Size     int64  `json:"size,omitempty"` // File size in bytes
}

// ========== MessageChunk helper methods ==========

// GetRole returns the role of this chunk based on its type
func (p *MessageChunk) GetRole() string {
	switch p.Type {
	case ChunkTypeToolResult:
		return RoleTool
	default:
		// text, reasoning, tool_call, image_url, etc. are all from assistant
		return RoleAssistant
	}
}

// GetToolCall returns tool call info from MessageChunk
func (p *MessageChunk) GetToolCall() *ToolCallChunk {
	if p.Type != ChunkTypeToolCall {
		return nil
	}
	return &ToolCallChunk{
		ID:        p.ToolCallID,
		Name:      p.ToolName,
		Arguments: p.ToolArgs,
	}
}

// GetToolResult returns tool result info from MessageChunk
func (p *MessageChunk) GetToolResult() *ToolResultChunk {
	if p.Type != ChunkTypeToolResult {
		return nil
	}
	return &ToolResultChunk{
		ToolCallID: p.ToolCallID,
		Name:       p.ToolName,
		Content:    p.ToolResultContent,
	}
}

// GetImageURL returns image URL info from MessageChunk
func (p *MessageChunk) GetImageURL() *ImageURL {
	if p.Type != ChunkTypeImageURL {
		return nil
	}
	return &ImageURL{
		URL:      p.MediaURL,
		MimeType: p.MediaMimeType,
		Detail:   p.MediaDetail,
	}
}

// ========== Legacy MessageChunks type for backward compatibility ==========

// MessageChunks is a slice of MessageChunk that can be stored as JSON in database
type MessageChunks []MessageChunk

// Value implements driver.Valuer for database storage
func (p *MessageChunks) Value() (driver.Value, error) {
	if p == nil || len(*p) == 0 {
		return nil, nil
	}
	return json.Marshal(*p)
}

// Scan implements sql.Scanner for database retrieval
func (p *MessageChunks) Scan(value interface{}) error {
	if value == nil {
		return nil
	}
	bytes, ok := value.([]byte)
	if !ok {
		return nil
	}
	return json.Unmarshal(bytes, p)
}

// TokenUsage represents token usage statistics
type TokenUsage struct {
	PromptTokens     int `json:"prompt_tokens"`
	CompletionTokens int `json:"completion_tokens"`
	TotalTokens      int `json:"total_tokens"`
}

// Value implements driver.Valuer for database storage
func (t *TokenUsage) Value() (driver.Value, error) {
	if t == nil {
		return nil, nil
	}
	if t.TotalTokens == 0 && t.PromptTokens == 0 && t.CompletionTokens == 0 {
		return nil, nil
	}
	return json.Marshal(t)
}

// Scan implements sql.Scanner for database retrieval
func (t *TokenUsage) Scan(value interface{}) error {
	if value == nil {
		return nil
	}
	bytes, ok := value.([]byte)
	if !ok {
		return nil
	}
	return json.Unmarshal(bytes, t)
}

// Message roles (OpenAI standard)
const (
	RoleUser      = "user"
	RoleAssistant = "assistant"
	RoleSystem    = "system"
	RoleTool      = "tool"
)

// Message status
const (
	MessageStatusPending   = "pending"
	MessageStatusStreaming = "streaming"
	MessageStatusCompleted = "completed"
	MessageStatusError     = "error"
)

// Finish reasons (OpenAI standard)
const (
	FinishReasonStop      = "stop"
	FinishReasonToolCalls = "tool_calls"
	FinishReasonLength    = "length"
	FinishReasonError     = "error"
	FinishReasonCancelled = "cancelled"
)

// ========== Message helper methods ==========

// AddTextChunk adds a text chunk to the message (in-memory only)
func (m *Message) AddTextChunk(text string, roundIndex int) {
	m.Chunks = append(m.Chunks, MessageChunk{
		Type:       ChunkTypeText,
		RoundIndex: roundIndex,
		Text:       text,
	})
}

// AddReasoningChunk adds a reasoning chunk to the message (in-memory only)
func (m *Message) AddReasoningChunk(text string, roundIndex int) {
	m.Chunks = append(m.Chunks, MessageChunk{
		Type:       ChunkTypeReasoning,
		RoundIndex: roundIndex,
		Text:       text,
	})
}

// AddToolCallChunk adds a tool call chunk to the message (in-memory only)
func (m *Message) AddToolCallChunk(id, name, arguments string, roundIndex int) {
	m.Chunks = append(m.Chunks, MessageChunk{
		Type:       ChunkTypeToolCall,
		RoundIndex: roundIndex,
		ToolCallID: id,
		ToolName:   name,
		ToolArgs:   arguments,
	})
}

// AddToolResultChunk adds a tool result chunk to the message (in-memory only)
func (m *Message) AddToolResultChunk(toolCallID, name, content string, roundIndex int) {
	m.Chunks = append(m.Chunks, MessageChunk{
		Type:              ChunkTypeToolResult,
		RoundIndex:        roundIndex,
		ToolCallID:        toolCallID,
		ToolName:          name,
		ToolResultContent: content,
	})
}

// AddImageChunk adds an image chunk to the message (in-memory only)
func (m *Message) AddImageChunk(url, mimeType, detail string) {
	m.Chunks = append(m.Chunks, MessageChunk{
		Type:          ChunkTypeImageURL,
		MediaURL:      url,
		MediaMimeType: mimeType,
		MediaDetail:   detail,
	})
}

// GetTextContent returns all text content concatenated
func (m *Message) GetTextContent() string {
	var result string
	for _, chunk := range m.Chunks {
		if chunk.Type == ChunkTypeText && chunk.Text != "" {
			if result != "" {
				result += "\n"
			}
			result += chunk.Text
		}
	}
	return result
}

// GetReasoningContent returns all reasoning content concatenated
func (m *Message) GetReasoningContent() string {
	var result string
	for _, chunk := range m.Chunks {
		if chunk.Type == ChunkTypeReasoning && chunk.Text != "" {
			if result != "" {
				result += "\n"
			}
			result += chunk.Text
		}
	}
	return result
}

// GetToolCalls returns all tool calls from chunks (in OpenAI ToolCall format)
func (m *Message) GetToolCalls() []ToolCall {
	var result []ToolCall
	for _, chunk := range m.Chunks {
		if chunk.Type == ChunkTypeToolCall {
			result = append(result, ToolCall{
				ID:   chunk.ToolCallID,
				Type: "function",
				Function: FunctionCall{
					Name:      chunk.ToolName,
					Arguments: chunk.ToolArgs,
				},
			})
		}
	}
	return result
}

// HasToolCalls returns true if message contains tool calls
func (m *Message) HasToolCalls() bool {
	for _, chunk := range m.Chunks {
		if chunk.Type == ChunkTypeToolCall {
			return true
		}
	}
	return false
}

// GetMaxRoundIndex returns the maximum round index in chunks
func (m *Message) GetMaxRoundIndex() int {
	maxIndex := 0
	for _, chunk := range m.Chunks {
		if chunk.RoundIndex > maxIndex {
			maxIndex = chunk.RoundIndex
		}
	}
	return maxIndex
}

// ========== OpenAI-compatible types (for API conversion) ==========

// ToolCall represents a tool call in OpenAI format (used in API)
type ToolCall struct {
	ID       string       `json:"id"`
	Type     string       `json:"type"` // "function"
	Function FunctionCall `json:"function"`
}

// FunctionCall represents a function call
type FunctionCall struct {
	Name      string `json:"name"`
	Arguments string `json:"arguments"` // JSON string
}

// ToolCalls is a slice of ToolCall that can be stored as JSON in database
type ToolCalls []ToolCall

// Value implements driver.Valuer for database storage
func (t *ToolCalls) Value() (driver.Value, error) {
	if t == nil || len(*t) == 0 {
		return nil, nil
	}
	return json.Marshal(t)
}

// Scan implements sql.Scanner for database retrieval
func (t *ToolCalls) Scan(value interface{}) error {
	if value == nil {
		return nil
	}
	bytes, ok := value.([]byte)
	if !ok {
		return nil
	}
	return json.Unmarshal(bytes, t)
}
