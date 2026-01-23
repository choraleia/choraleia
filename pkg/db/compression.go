// Database models for conversation compression
package db

import (
	"database/sql/driver"
	"encoding/json"
	"errors"
	"time"
)

// ConversationSnapshot represents a compression snapshot
type ConversationSnapshot struct {
	ID             string `json:"id" gorm:"primaryKey;size:36"`
	ConversationID string `json:"conversation_id" gorm:"index;size:36;not null"`
	WorkspaceID    string `json:"workspace_id" gorm:"index;size:36"`

	// Compression content
	Summary      string      `json:"summary" gorm:"type:text"`
	KeyTopics    StringArray `json:"key_topics" gorm:"type:json"`
	KeyDecisions StringArray `json:"key_decisions" gorm:"type:json"`

	// Compression range
	FromMessageID string `json:"from_message_id" gorm:"size:36"`
	ToMessageID   string `json:"to_message_id" gorm:"size:36"`
	MessageCount  int    `json:"message_count"`

	// Token statistics
	OriginalTokens   int     `json:"original_tokens"`
	CompressedTokens int     `json:"compressed_tokens"`
	CompressionRatio float64 `json:"compression_ratio"`

	// Related memories created from this compression
	MemoryIDs StringArray `json:"memory_ids" gorm:"type:json"`

	CreatedAt time.Time `json:"created_at"`
}

// TableName returns the table name
func (ConversationSnapshot) TableName() string {
	return "conversation_snapshots"
}

// CompressionExtractedData represents data extracted during compression
type CompressionExtractedData struct {
	Summary                string   `json:"summary"`
	KeyTopics              []string `json:"key_topics"`
	KeyDecisions           []string `json:"key_decisions"`
	ExtractedFacts         []string `json:"extracted_facts"`
	UserPreferences        []string `json:"user_preferences"`
	ImportantDetails       []string `json:"important_details"`
	ContextForContinuation string   `json:"context_for_continuation"`
}

// Scan implements sql.Scanner for CompressionExtractedData
func (c *CompressionExtractedData) Scan(value interface{}) error {
	if value == nil {
		return nil
	}
	bytes, ok := value.([]byte)
	if !ok {
		return errors.New("type assertion to []byte failed")
	}
	return json.Unmarshal(bytes, c)
}

// Value implements driver.Valuer for CompressionExtractedData
func (c CompressionExtractedData) Value() (driver.Value, error) {
	return json.Marshal(c)
}
