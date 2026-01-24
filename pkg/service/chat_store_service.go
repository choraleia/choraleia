package service

import (
	"encoding/json"
	"gorm.io/gorm/logger"
	"log/slog"
	"os"
	"path/filepath"
	"time"

	"github.com/choraleia/choraleia/pkg/api"
	"github.com/choraleia/choraleia/pkg/utils"

	"github.com/cloudwego/eino/schema"
	"github.com/glebarez/sqlite"
	"github.com/google/uuid"
	"github.com/pkg/errors"
	"gorm.io/gorm"
)

// Conversation table-top level entity
type Conversation struct {
	ID             string    `json:"id" gorm:"primaryKey"`
	Title          string    `json:"title" gorm:"not null"`
	AssetID        string    `json:"asset_id" gorm:"index"`         // related asset ID
	AssetSessionID string    `json:"asset_session_id" gorm:"index"` // session ID per terminal tab
	CreatedAt      time.Time `json:"created_at"`
	UpdatedAt      time.Time `json:"updated_at"`
}

func (Conversation) TableName() string {
	return "conversation"
}

const (
	ContentTypeText      = "text"
	ContentTypeReasoning = "reasoning"
	ContentTypeToolCall  = "tool-call"
)

type ContentType struct {
	Type string `json:"type"`
}

type TextContent struct {
	Type string `json:"type"`
	Text string `json:"text"`
}

type ReasoningContent struct {
	Type string `json:"type"`
	Text string `json:"text"`
}

type ToolCallContent struct {
	Type      string `json:"type"`
	ID        string `json:"id"`
	Name      string `json:"name"`
	Arguments string `json:"arguments"`
	Result    string `json:"result"`
}

type MessageContent struct {
	ID        int64     `json:"id" gorm:"primaryKey,autoIncrement"`
	MessageID string    `json:"message_id"`
	Type      string    `json:"type"`
	Content   string    `json:"content"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

// TableName specify table name
func (MessageContent) TableName() string {
	return "message_content"
}

// Message database stored message model
type Message struct {
	ID             int64            `json:"id" gorm:"primaryKey,autoIncrement"`
	ConversationID string           `json:"conversationId"`
	MessageID      string           `json:"messageId"`
	ParentID       string           `json:"parentId,omitempty"`
	Role           string           `json:"role"`
	Content        []MessageContent `json:"contents,omitempty" gorm:"foreignKey:MessageID;references:MessageID;constraint:OnDelete:CASCADE"`
	CreatedAt      time.Time        `json:"created_at"`
	UpdatedAt      time.Time        `json:"updated_at"`
}

// TableName specify table name
func (Message) TableName() string {
	return "message"
}

// ChatStoreService chat storage service
type ChatStoreService struct {
	db     *gorm.DB
	logger *slog.Logger
}

// DB returns the database instance for use by other services
func (cs *ChatStoreService) DB() *gorm.DB {
	return cs.db
}

// NewChatStore create chat service
func NewChatStore() (*ChatStoreService, error) {
	homeDir, _ := os.UserHomeDir()
	dbFile := filepath.Join(homeDir, ".choraleia", "chat.db")

	// Ensure directory exists
	_ = os.MkdirAll(filepath.Dir(dbFile), 0755)

	db, err := gorm.Open(sqlite.Open(dbFile), &gorm.Config{
		Logger: logger.Default.LogMode(logger.Warn), // Suppress INFO level (including record not found)
	})
	if err != nil {
		return nil, err
	}

	// Auto migrate database tables
	err = db.AutoMigrate(&Conversation{}, &Message{}, &MessageContent{})
	if err != nil {
		return nil, err
	}

	return &ChatStoreService{db: db, logger: utils.GetLogger()}, nil
}

// CreateConversation create new conversation
func (cs *ChatStoreService) CreateConversation(title, assetID, assetSessionID string) (*Conversation, error) {
	conversation := &Conversation{
		ID:             uuid.New().String(),
		Title:          title,
		AssetID:        assetID,
		AssetSessionID: assetSessionID,
	}

	err := cs.db.Create(conversation).Error
	return conversation, err
}

// GetConversations get all conversations list
func (cs *ChatStoreService) GetConversations() ([]Conversation, error) {
	var conversations []Conversation
	err := cs.db.Order("updated_at DESC").Find(&conversations).Error
	return conversations, err
}

// GetConversationsByAssetID get conversations by asset ID
func (cs *ChatStoreService) GetConversationsByAssetID(assetID string) ([]Conversation, error) {
	var conversations []Conversation
	err := cs.db.Where("asset_id = ?", assetID).Order("updated_at DESC").Find(&conversations).Error
	return conversations, err
}

// GetConversation get single conversation
func (cs *ChatStoreService) GetConversation(id string) (*Conversation, error) {
	var conversation Conversation
	err := cs.db.First(&conversation, "id = ?", id).Error
	return &conversation, err
}

// UpdateConversationTitle update conversation title
func (cs *ChatStoreService) UpdateConversationTitle(id, title string) error {
	return cs.db.Model(&Conversation{}).Where("id = ?", id).Updates(map[string]interface{}{
		"title":      title,
		"updated_at": time.Now(),
	}).Error
}

// DeleteConversation delete conversation and all its messages
func (cs *ChatStoreService) DeleteConversation(id string) error {
	tx := cs.db.Begin()

	// Delete messages
	if err := tx.Where("conversation_id = ?", id).Delete(&Message{}).Error; err != nil {
		cs.logger.Error("Failed to delete conversation", "error", err)
		tx.Rollback()
		return err
	}

	// Delete conversation
	if err := tx.Where("id = ?", id).Delete(&Conversation{}).Error; err != nil {
		tx.Rollback()
		return err
	}

	return tx.Commit().Error
}

// CreateMessage persist message
func (cs *ChatStoreService) CreateMessage(conversationId, messageId, parentId, role string) (err error) {
	chatMessage := &Message{
		ConversationID: conversationId,
		MessageID:      messageId,
		ParentID:       parentId,
		Role:           role,
	}
	return cs.db.Save(chatMessage).Error
}

//func (cs *ChatStoreService) GetChatMessages(conversationId string, parentId string) ([]*api.ChatMessage, error) {
//}

func (cs *ChatStoreService) AppendMessageContentFromSchema(messageId string, message *schema.Message) error {
	if message.ReasoningContent != "" {
		reasoningContent := ReasoningContent{
			Type: ContentTypeReasoning,
			Text: message.ReasoningContent,
		}
		contentBytes, err := json.Marshal(reasoningContent)
		if err != nil {
			return errors.Wrap(err, "failed to marshal reasoning content")
		}
		err = cs.db.Create(&MessageContent{
			MessageID: messageId,
			Type:      ContentTypeReasoning,
			Content:   string(contentBytes),
		}).Error
		if err != nil {
			return errors.Wrap(err, "failed to save reasoning content")
		}
	}
	if message.Content != "" {
		textContent := TextContent{
			Type: ContentTypeText,
			Text: message.Content,
		}
		contentBytes, err := json.Marshal(textContent)
		if err != nil {
			return errors.Wrap(err, "failed to marshal text content")
		}
		err = cs.db.Create(&MessageContent{
			MessageID: messageId,
			Type:      ContentTypeText,
			Content:   string(contentBytes),
		}).Error
		if err != nil {
			return errors.Wrap(err, "failed to save text content")
		}
	}
	if len(message.ToolCalls) > 0 {
		for _, toolCall := range message.ToolCalls {
			toolCallContent := ToolCallContent{
				Type:      ContentTypeToolCall,
				ID:        toolCall.ID,
				Name:      toolCall.Function.Name,
				Arguments: toolCall.Function.Arguments,
			}
			toolCallBytes, err := json.Marshal(toolCallContent)
			if err != nil {
				return errors.Wrap(err, "failed to marshal tool call content")
			}
			err = cs.db.Create(&MessageContent{
				MessageID: messageId,
				Type:      ContentTypeToolCall,
				Content:   string(toolCallBytes),
			}).Error
			if err != nil {
				return errors.Wrap(err, "failed to save tool call content")
			}
		}
	}
	if message.Role == schema.Tool {
		// If tool call result, persist result content
		contents := &[]MessageContent{}
		err := cs.db.Where("message_id = ? AND type = ?", messageId, ContentTypeToolCall).Find(contents).Error
		if err != nil {
			return errors.Wrap(err, "failed to query tool call content")
		}
		for _, content := range *contents {
			var toolCallContent ToolCallContent
			err := json.Unmarshal([]byte(content.Content), &toolCallContent)
			if err != nil {
				return errors.Wrap(err, "failed to unmarshal tool call content")
			}
			if toolCallContent.ID == message.ToolCallID {
				toolCallContent.Result = message.Content
				updatedBytes, err := json.Marshal(toolCallContent)
				if err != nil {
					return errors.Wrap(err, "failed to marshal updated tool call content")
				}
				content.Content = string(updatedBytes)
				err = cs.db.Save(&content).Error
				if err != nil {
					return errors.Wrap(err, "failed to update tool call content with result")
				}
			}
		}
	}
	return nil
}

// GetSchemaMessages get conversation message chain (query by conversationID only, ignore parentId)
func (cs *ChatStoreService) GetSchemaMessages(conversationID, parentId string) ([]*schema.Message, error) {
	var messages []Message
	// Only query by conversationID and ignore parentId
	err := cs.db.Where("conversation_id = ?", conversationID).Order("created_at ASC").Find(&messages).Error
	if err != nil {
		return nil, err
	}

	var result []*schema.Message
	for _, msg := range messages {
		var contents []MessageContent
		err := cs.db.Where("message_id = ?", msg.MessageID).Find(&contents).Error
		if err != nil {
			return nil, err
		}

		for _, content := range contents {
			schemaMsg := &schema.Message{
				Role: schema.RoleType(msg.Role),
			}
			var toolCallResultMessage *schema.Message

			switch content.Type {
			case ContentTypeText:
				var textContent TextContent
				if err := json.Unmarshal([]byte(content.Content), &textContent); err == nil {
					schemaMsg.Content = textContent.Text
				}
			case ContentTypeReasoning:
				var reasoningContent ReasoningContent
				if err := json.Unmarshal([]byte(content.Content), &reasoningContent); err == nil {
					schemaMsg.ReasoningContent = reasoningContent.Text
				}
			case ContentTypeToolCall:
				var toolCallContent ToolCallContent
				if err := json.Unmarshal([]byte(content.Content), &toolCallContent); err == nil {
					// ToolCalls structure needs adapting to schema.Message
					if schemaMsg.ToolCalls == nil {
						schemaMsg.ToolCalls = []schema.ToolCall{}
					}
					schemaMsg.ToolCalls = append(schemaMsg.ToolCalls, schema.ToolCall{
						ID:   toolCallContent.ID,
						Type: "function",
						Function: schema.FunctionCall{
							Name:      toolCallContent.Name,
							Arguments: toolCallContent.Arguments,
						},
					})
				}
				if toolCallContent.Result != "" {
					toolCallResultMessage = &schema.Message{
						Role:       schema.Tool,
						Content:    toolCallContent.Result,
						ToolCallID: toolCallContent.ID,
						ToolName:   toolCallContent.Name,
					}
				}
			}
			result = append(result, schemaMsg)
			if toolCallResultMessage != nil {
				result = append(result, toolCallResultMessage)
			}
		}
	}
	return result, nil
}

// GetConversationMessages get all messages and contents of specified conversation
func (cs *ChatStoreService) GetConversationMessages(conversationID string) ([]api.ChatMessage, error) {
	var messages []Message
	// Query all messages ordered by creation time ascending
	err := cs.db.Where("conversation_id = ?", conversationID).Order("created_at ASC").Find(&messages).Error
	if err != nil {
		return nil, err
	}
	var result []api.ChatMessage
	for _, msg := range messages {
		var contents []MessageContent
		err := cs.db.Where("message_id = ?", msg.MessageID).Order("created_at ASC").Find(&contents).Error
		if err != nil {
			return nil, err
		}
		var parsedContents []map[string]interface{}
		for _, c := range contents {
			var m map[string]interface{}
			if err := json.Unmarshal([]byte(c.Content), &m); err == nil {
				parsedContents = append(parsedContents, m)
			}
		}
		chatMsg := api.ChatMessage{
			ConversationID: msg.ConversationID,
			MessageID:      msg.MessageID,
			ParentID:       msg.ParentID,
			Role:           msg.Role,
			Content:        parsedContents,
			CreatedAt:      msg.CreatedAt,
			UpdatedAt:      msg.UpdatedAt,
		}
		result = append(result, chatMsg)
	}
	return result, nil
}
