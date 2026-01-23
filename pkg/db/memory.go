// Database models for memory system
package db

import (
	"database/sql/driver"
	"encoding/json"
	"errors"
	"time"
)

// ========== Memory Scope and Visibility ==========

// MemoryScope defines the scope of a memory
type MemoryScope string

const (
	MemoryScopeWorkspace MemoryScope = "workspace" // Workspace-level, accessible by all agents
	MemoryScopeAgent     MemoryScope = "agent"     // Agent-level, private by default
)

// MemoryVisibility defines visibility of a memory
type MemoryVisibility string

const (
	MemoryVisibilityPublic  MemoryVisibility = "public"  // Visible to all agents
	MemoryVisibilityPrivate MemoryVisibility = "private" // Only visible to creator
	MemoryVisibilityInherit MemoryVisibility = "inherit" // Inherit from scope default
)

// MemoryType defines the type of memory content
type MemoryType string

const (
	MemoryTypeFact        MemoryType = "fact"        // Factual information
	MemoryTypePreference  MemoryType = "preference"  // User preferences
	MemoryTypeInstruction MemoryType = "instruction" // User instructions/rules
	MemoryTypeLearned     MemoryType = "learned"     // AI-learned patterns
	MemoryTypeSummary     MemoryType = "summary"     // Conversation summary (from compression)
	MemoryTypeDetail      MemoryType = "detail"      // Important details (from compression)
)

// MemorySourceType defines the source of a memory
type MemorySourceType string

const (
	MemorySourceConversation MemorySourceType = "conversation" // Extracted from conversation
	MemorySourceCompression  MemorySourceType = "compression"  // Generated during compression
	MemorySourceTool         MemorySourceType = "tool"         // Stored via agent tool
	MemorySourceUser         MemorySourceType = "user"         // Manually added by user
	MemorySourceSystem       MemorySourceType = "system"       // System-generated
)

// ========== Memory Model ==========

// Memory represents a piece of stored knowledge
type Memory struct {
	ID          string `json:"id" gorm:"primaryKey;size:36"`
	WorkspaceID string `json:"workspace_id" gorm:"index:idx_memory_workspace_scope;size:36;not null"`

	// Ownership scope
	Scope      MemoryScope      `json:"scope" gorm:"index:idx_memory_workspace_scope;size:20;not null;default:'workspace'"`
	AgentID    *string          `json:"agent_id,omitempty" gorm:"index;size:36"`
	Visibility MemoryVisibility `json:"visibility" gorm:"size:20;default:'inherit'"`

	// Memory content
	Type     MemoryType `json:"type" gorm:"index;size:30;not null"`
	Category string     `json:"category,omitempty" gorm:"index;size:100"`
	Key      string     `json:"key" gorm:"index:idx_memory_workspace_key,unique;size:200"`
	Content  string     `json:"content" gorm:"type:text;not null"`
	Metadata JSONMap    `json:"metadata,omitempty" gorm:"type:json"`

	// Source tracking
	SourceType MemorySourceType `json:"source_type,omitempty" gorm:"size:30"`
	SourceID   *string          `json:"source_id,omitempty" gorm:"size:36"`

	// Retrieval optimization
	Tags StringArray `json:"tags,omitempty" gorm:"type:json"`

	// Lifecycle management
	Importance  int        `json:"importance" gorm:"default:50"`
	AccessCount int        `json:"access_count" gorm:"default:0"`
	LastAccess  *time.Time `json:"last_access,omitempty"`
	ExpiresAt   *time.Time `json:"expires_at,omitempty"`

	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

// TableName returns the table name for Memory
func (Memory) TableName() string {
	return "memories"
}

// ========== Helper Types ==========

// StringArray is a slice of strings stored as JSON
type StringArray []string

// Value implements driver.Valuer for StringArray
func (s StringArray) Value() (driver.Value, error) {
	if s == nil {
		return "[]", nil
	}
	return json.Marshal(s)
}

// Scan implements sql.Scanner for StringArray
func (s *StringArray) Scan(value interface{}) error {
	if value == nil {
		*s = nil
		return nil
	}
	var bytes []byte
	switch v := value.(type) {
	case []byte:
		bytes = v
	case string:
		bytes = []byte(v)
	default:
		return errors.New("type assertion to []byte or string failed")
	}
	return json.Unmarshal(bytes, s)
}

// JSONMap is a generic JSON map type (reuse from models if needed)
type JSONMap map[string]interface{}

// Value implements driver.Valuer for JSONMap
func (j JSONMap) Value() (driver.Value, error) {
	if j == nil {
		return nil, nil
	}
	return json.Marshal(j)
}

// Scan implements sql.Scanner for JSONMap
func (j *JSONMap) Scan(value interface{}) error {
	if value == nil {
		*j = nil
		return nil
	}
	var bytes []byte
	switch v := value.(type) {
	case []byte:
		bytes = v
	case string:
		bytes = []byte(v)
	default:
		return errors.New("type assertion to []byte or string failed")
	}
	return json.Unmarshal(bytes, j)
}

// ========== Request/Response Types ==========

// CreateMemoryRequest represents a request to create a memory
type CreateMemoryRequest struct {
	Type       MemoryType       `json:"type" binding:"required"`
	Key        string           `json:"key" binding:"required"`
	Content    string           `json:"content" binding:"required"`
	Scope      MemoryScope      `json:"scope"`
	AgentID    *string          `json:"agent_id,omitempty"`
	Visibility MemoryVisibility `json:"visibility"`
	Category   string           `json:"category,omitempty"`
	Tags       []string         `json:"tags,omitempty"`
	Metadata   map[string]any   `json:"metadata,omitempty"`
	Importance int              `json:"importance"`
	SourceType MemorySourceType `json:"source_type,omitempty"`
	SourceID   *string          `json:"source_id,omitempty"`
}

// UpdateMemoryRequest represents a request to update a memory
type UpdateMemoryRequest struct {
	Content    *string           `json:"content,omitempty"`
	Category   *string           `json:"category,omitempty"`
	Tags       []string          `json:"tags,omitempty"`
	Metadata   map[string]any    `json:"metadata,omitempty"`
	Importance *int              `json:"importance,omitempty"`
	Visibility *MemoryVisibility `json:"visibility,omitempty"`
}

// MemoryQueryOptions defines options for querying memories
type MemoryQueryOptions struct {
	WorkspaceID   string
	AgentID       *string
	Types         []MemoryType
	Categories    []string
	Tags          []string
	Scopes        []MemoryScope
	MinImportance int
	Keyword       string
	Limit         int
	Offset        int
	OrderBy       string // created_at, importance, access_count, last_access
	OrderDesc     bool
}

// MemorySearchResult represents a memory search result with score
type MemorySearchResult struct {
	Memory
	Similarity float32 `json:"similarity,omitempty"`
}
