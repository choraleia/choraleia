package models

import "time"

// QuickCommand represents a reusable terminal command snippet
type QuickCommand struct {
	ID        string    `json:"id"`
	Name      string    `json:"name"`
	Content   string    `json:"content"`
	Tags      []string  `json:"tags"`
	Order     int       `json:"order"`
	UpdatedAt time.Time `json:"updatedAt"`
}

type CreateQuickCommandRequest struct {
	Name    string   `json:"name" binding:"required"`
	Content string   `json:"content" binding:"required"`
	Tags    []string `json:"tags"`
}

type UpdateQuickCommandRequest struct {
	Name    *string   `json:"name"`
	Content *string   `json:"content"`
	Tags    *[]string `json:"tags"`
}

type ReorderQuickCommandsRequest struct {
	IDs []string `json:"ids" binding:"required"`
}

type QuickCommandListResponse struct {
	Commands []QuickCommand `json:"commands"`
	Total    int            `json:"total"`
}
