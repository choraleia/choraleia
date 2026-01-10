// Database models for chat messages
package db

import (
	"database/sql/driver"
	"encoding/json"
	"time"
)

// Message represents a chat message (OpenAI-compatible format)
// One Message.ID = one complete message visible to user
// For agent multi-round scenarios, all rounds are stored in Parts
type Message struct {
	ID             string `json:"id" gorm:"primaryKey;size:36"`
	ConversationID string `json:"conversation_id" gorm:"index;size:36;not null"`

	// Branch support - enables message tree structure
	ParentID    *string `json:"parent_id,omitempty" gorm:"index;size:36"` // Parent message ID (nil for root messages)
	BranchIndex int     `json:"branch_index" gorm:"default:0"`            // Index among siblings (0, 1, 2... for branches)

	// Core fields
	Role  string       `json:"role" gorm:"size:20;not null"`     // user, assistant, system
	Parts MessageParts `json:"parts,omitempty" gorm:"type:text"` // JSON: []MessagePart - all content parts
	Name  string       `json:"name,omitempty" gorm:"size:100"`   // Optional name

	// Status and metadata
	Status       string     `json:"status" gorm:"size:20;default:'completed'"` // pending, streaming, completed, error
	FinishReason string     `json:"finish_reason,omitempty" gorm:"size:20"`    // stop, tool_calls, length, error
	Usage        TokenUsage `json:"usage,omitempty" gorm:"type:text"`          // JSON

	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

func (Message) TableName() string {
	return "messages"
}

// ========== MessagePart types ==========

// MessagePart type constants
const (
	PartTypeText       = "text"        // Text content
	PartTypeReasoning  = "reasoning"   // Reasoning/thinking content
	PartTypeToolCall   = "tool_call"   // Tool call request
	PartTypeToolResult = "tool_result" // Tool call result
	PartTypeImageURL   = "image_url"   // Image (eino compatible)
	PartTypeAudioURL   = "audio_url"   // Audio
	PartTypeVideoURL   = "video_url"   // Video
	PartTypeFileURL    = "file_url"    // File
)

// MessagePart represents a content part in a message
type MessagePart struct {
	Type  string `json:"type"`            // Part type
	Index int    `json:"index,omitempty"` // Round index for agent multi-round scenarios

	// Text content (for text, reasoning)
	Text string `json:"text,omitempty"`

	// Tool call (for tool_call)
	ToolCall *ToolCallPart `json:"tool_call,omitempty"`

	// Tool result (for tool_result)
	ToolResult *ToolResultPart `json:"tool_result,omitempty"`

	// Media content (eino schema compatible)
	ImageURL *ImageURL `json:"image_url,omitempty"`
	AudioURL *AudioURL `json:"audio_url,omitempty"`
	VideoURL *VideoURL `json:"video_url,omitempty"`
	FileURL  *FileURL  `json:"file_url,omitempty"`
}

// ToolCallPart represents a tool call in a message part
type ToolCallPart struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	Arguments string `json:"arguments"` // JSON string
}

// ToolResultPart represents a tool result in a message part
type ToolResultPart struct {
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

// MessageParts is a slice of MessagePart that can be stored as JSON in database
type MessageParts []MessagePart

// Value implements driver.Valuer for database storage
func (p MessageParts) Value() (driver.Value, error) {
	if p == nil || len(p) == 0 {
		return nil, nil
	}
	return json.Marshal(p)
}

// Scan implements sql.Scanner for database retrieval
func (p *MessageParts) Scan(value interface{}) error {
	if value == nil {
		*p = nil
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
func (t TokenUsage) Value() (driver.Value, error) {
	if t.TotalTokens == 0 && t.PromptTokens == 0 && t.CompletionTokens == 0 {
		return nil, nil
	}
	return json.Marshal(t)
}

// Scan implements sql.Scanner for database retrieval
func (t *TokenUsage) Scan(value interface{}) error {
	if value == nil {
		*t = TokenUsage{}
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

// AddTextPart adds a text part to the message
func (m *Message) AddTextPart(text string, index int) {
	m.Parts = append(m.Parts, MessagePart{
		Type:  PartTypeText,
		Index: index,
		Text:  text,
	})
}

// AddReasoningPart adds a reasoning part to the message
func (m *Message) AddReasoningPart(text string, index int) {
	m.Parts = append(m.Parts, MessagePart{
		Type:  PartTypeReasoning,
		Index: index,
		Text:  text,
	})
}

// AddToolCallPart adds a tool call part to the message
func (m *Message) AddToolCallPart(id, name, arguments string, index int) {
	m.Parts = append(m.Parts, MessagePart{
		Type:  PartTypeToolCall,
		Index: index,
		ToolCall: &ToolCallPart{
			ID:        id,
			Name:      name,
			Arguments: arguments,
		},
	})
}

// AddToolResultPart adds a tool result part to the message
func (m *Message) AddToolResultPart(toolCallID, name, content string, index int) {
	m.Parts = append(m.Parts, MessagePart{
		Type:  PartTypeToolResult,
		Index: index,
		ToolResult: &ToolResultPart{
			ToolCallID: toolCallID,
			Name:       name,
			Content:    content,
		},
	})
}

// AddImagePart adds an image part to the message
func (m *Message) AddImagePart(url, mimeType, detail string) {
	m.Parts = append(m.Parts, MessagePart{
		Type: PartTypeImageURL,
		ImageURL: &ImageURL{
			URL:      url,
			MimeType: mimeType,
			Detail:   detail,
		},
	})
}

// GetTextContent returns all text content concatenated
func (m *Message) GetTextContent() string {
	var result string
	for _, part := range m.Parts {
		if part.Type == PartTypeText && part.Text != "" {
			if result != "" {
				result += "\n"
			}
			result += part.Text
		}
	}
	return result
}

// GetReasoningContent returns all reasoning content concatenated
func (m *Message) GetReasoningContent() string {
	var result string
	for _, part := range m.Parts {
		if part.Type == PartTypeReasoning && part.Text != "" {
			if result != "" {
				result += "\n"
			}
			result += part.Text
		}
	}
	return result
}

// GetToolCalls returns all tool calls from parts (in OpenAI ToolCall format)
func (m *Message) GetToolCalls() []ToolCall {
	var result []ToolCall
	for _, part := range m.Parts {
		if part.Type == PartTypeToolCall && part.ToolCall != nil {
			result = append(result, ToolCall{
				ID:   part.ToolCall.ID,
				Type: "function",
				Function: FunctionCall{
					Name:      part.ToolCall.Name,
					Arguments: part.ToolCall.Arguments,
				},
			})
		}
	}
	return result
}

// HasToolCalls returns true if message contains tool calls
func (m *Message) HasToolCalls() bool {
	for _, part := range m.Parts {
		if part.Type == PartTypeToolCall {
			return true
		}
	}
	return false
}

// GetMaxRoundIndex returns the maximum round index in parts
func (m *Message) GetMaxRoundIndex() int {
	maxIndex := 0
	for _, part := range m.Parts {
		if part.Index > maxIndex {
			maxIndex = part.Index
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
func (t ToolCalls) Value() (driver.Value, error) {
	if t == nil || len(t) == 0 {
		return nil, nil
	}
	return json.Marshal(t)
}

// Scan implements sql.Scanner for database retrieval
func (t *ToolCalls) Scan(value interface{}) error {
	if value == nil {
		*t = nil
		return nil
	}
	bytes, ok := value.([]byte)
	if !ok {
		return nil
	}
	return json.Unmarshal(bytes, t)
}
