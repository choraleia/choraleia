package service

import (
	"context"
	"time"

	"github.com/choraleia/choraleia/pkg/models"
	"github.com/google/uuid"
)

// RoomService handles room operations within a workspace
type RoomService struct {
	ws *WorkspaceService
}

// NewRoomService creates a new RoomService
func NewRoomService(ws *WorkspaceService) *RoomService {
	return &RoomService{ws: ws}
}

// CreateRoomRequest represents a request to create a room
type CreateRoomRequest struct {
	Name        string  `json:"name"`
	Description *string `json:"description,omitempty"`
}

// Create creates a new room in a workspace
func (s *RoomService) Create(ctx context.Context, workspaceID string, req *CreateRoomRequest) (*models.Room, error) {
	// Verify workspace exists
	if _, err := s.ws.Get(ctx, workspaceID); err != nil {
		return nil, err
	}

	room := &models.Room{
		ID:          uuid.New().String(),
		WorkspaceID: workspaceID,
		Name:        req.Name,
		Description: req.Description,
		CreatedAt:   time.Now(),
		UpdatedAt:   time.Now(),
	}

	if err := s.ws.DB().Create(room).Error; err != nil {
		return nil, err
	}

	return room, nil
}

// Get retrieves a room by ID
func (s *RoomService) Get(ctx context.Context, workspaceID, roomID string) (*models.Room, error) {
	var room models.Room
	err := s.ws.DB().First(&room, "id = ? AND workspace_id = ?", roomID, workspaceID).Error
	if err != nil {
		return nil, ErrRoomNotFound
	}
	return &room, nil
}

// List lists all rooms in a workspace
func (s *RoomService) List(ctx context.Context, workspaceID string) ([]models.Room, error) {
	var rooms []models.Room
	err := s.ws.DB().Where("workspace_id = ?", workspaceID).Order("created_at ASC").Find(&rooms).Error
	if err != nil {
		return nil, err
	}
	return rooms, nil
}

// UpdateRoomRequest represents a request to update a room
type UpdateRoomRequest struct {
	Name                  *string         `json:"name,omitempty"`
	Description           *string         `json:"description,omitempty"`
	Layout                *models.JSONMap `json:"layout,omitempty"`
	CurrentConversationID *string         `json:"current_conversation_id,omitempty"`
}

// Update updates a room
func (s *RoomService) Update(ctx context.Context, workspaceID, roomID string, req *UpdateRoomRequest) (*models.Room, error) {
	room, err := s.Get(ctx, workspaceID, roomID)
	if err != nil {
		return nil, err
	}

	updates := map[string]interface{}{
		"updated_at": time.Now(),
	}
	if req.Name != nil {
		updates["name"] = *req.Name
	}
	if req.Description != nil {
		updates["description"] = *req.Description
	}
	if req.Layout != nil {
		updates["layout"] = *req.Layout
	}
	if req.CurrentConversationID != nil {
		updates["current_conversation_id"] = *req.CurrentConversationID
	}

	if err := s.ws.DB().Model(room).Updates(updates).Error; err != nil {
		return nil, err
	}

	return s.Get(ctx, workspaceID, roomID)
}

// Delete deletes a room
func (s *RoomService) Delete(ctx context.Context, workspaceID, roomID string) error {
	// Check room exists
	if _, err := s.Get(ctx, workspaceID, roomID); err != nil {
		return err
	}

	// Count rooms
	var count int64
	if err := s.ws.DB().Model(&models.Room{}).Where("workspace_id = ?", workspaceID).Count(&count).Error; err != nil {
		return err
	}
	if count <= 1 {
		return ErrCannotDeleteLastRoom
	}

	// Get workspace to check if deleting active room
	workspace, err := s.ws.Get(ctx, workspaceID)
	if err != nil {
		return err
	}

	// Delete room
	if err := s.ws.DB().Delete(&models.Room{}, "id = ?", roomID).Error; err != nil {
		return err
	}

	// If deleted room was active, set new active room
	if workspace.ActiveRoomID == roomID {
		var newActiveRoom models.Room
		if err := s.ws.DB().Where("workspace_id = ?", workspaceID).First(&newActiveRoom).Error; err == nil {
			s.ws.DB().Model(&models.Workspace{}).Where("id = ?", workspaceID).Update("active_room_id", newActiveRoom.ID)
		}
	}

	return nil
}

// Clone clones a room
func (s *RoomService) Clone(ctx context.Context, workspaceID, roomID string, newName string) (*models.Room, error) {
	room, err := s.Get(ctx, workspaceID, roomID)
	if err != nil {
		return nil, err
	}

	newRoom := &models.Room{
		ID:          uuid.New().String(),
		WorkspaceID: workspaceID,
		Name:        newName,
		Description: room.Description,
		Layout:      room.Layout,
		CreatedAt:   time.Now(),
		UpdatedAt:   time.Now(),
	}

	if err := s.ws.DB().Create(newRoom).Error; err != nil {
		return nil, err
	}

	return newRoom, nil
}

// Activate sets a room as the active room for a workspace
func (s *RoomService) Activate(ctx context.Context, workspaceID, roomID string) error {
	// Verify room exists
	if _, err := s.Get(ctx, workspaceID, roomID); err != nil {
		return err
	}

	return s.ws.DB().Model(&models.Workspace{}).Where("id = ?", workspaceID).Update("active_room_id", roomID).Error
}
