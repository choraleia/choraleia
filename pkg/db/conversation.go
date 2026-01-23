// Database models for chat conversations
package db

import "time"

// Conversation represents a chat conversation in a workspace
type Conversation struct {
	ID          string `json:"id" gorm:"primaryKey;size:36"`
	WorkspaceID string `json:"workspace_id" gorm:"index;size:36;not null"`
	RoomID      string `json:"room_id,omitempty" gorm:"index;size:36"`
	Title       string `json:"title" gorm:"size:200;default:'New Chat'"`
	ModelID     string `json:"model_id,omitempty" gorm:"size:100"`
	Status      string `json:"status" gorm:"size:20;default:'active'"` // active, archived

	// Compression-related fields
	CompressedAt     *time.Time  `json:"compressed_at,omitempty"`
	CompressionCount int         `json:"compression_count" gorm:"default:0"`
	Summary          string      `json:"summary,omitempty" gorm:"type:text"`
	KeyTopics        StringArray `json:"key_topics,omitempty" gorm:"type:json"`
	KeyDecisions     StringArray `json:"key_decisions,omitempty" gorm:"type:json"`

	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

func (Conversation) TableName() string {
	return "conversations"
}

// Conversation status
const (
	ConversationStatusActive   = "active"
	ConversationStatusArchived = "archived"
)
