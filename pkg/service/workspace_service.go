package service

import (
	"context"
	"errors"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"github.com/choraleia/choraleia/pkg/models"
	"github.com/choraleia/choraleia/pkg/service/fs"
	"github.com/choraleia/choraleia/pkg/service/repomap"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

var (
	ErrWorkspaceNotFound    = errors.New("workspace not found")
	ErrWorkspaceNameExists  = errors.New("workspace name already exists")
	ErrWorkspaceNameInvalid = errors.New("workspace name is invalid (must be DNS compatible)")
	ErrWorkspaceRunning     = errors.New("workspace is running")
	ErrWorkspaceNotRunning  = errors.New("workspace is not running")
	ErrRoomNotFound         = errors.New("room not found")
	ErrCannotDeleteLastRoom = errors.New("cannot delete the last room")
)

// workspaceNameRegex validates DNS-compatible names
var workspaceNameRegex = regexp.MustCompile(`^[a-z0-9]([a-z0-9-]*[a-z0-9])?$`)

// WorkspaceService handles workspace operations
type WorkspaceService struct {
	db             *gorm.DB
	runtimeManager *RuntimeManager
	toolManager    *ToolManager
	repoMapService *repomap.RepoMapService
	fsRegistry     *FSRegistry
}

// NewWorkspaceService creates a new WorkspaceService
func NewWorkspaceService(db *gorm.DB) *WorkspaceService {
	return &WorkspaceService{
		db:             db,
		runtimeManager: NewRuntimeManager(),
		toolManager:    NewToolManager(),
	}
}

// DB returns the database instance
func (s *WorkspaceService) DB() *gorm.DB {
	return s.db
}

// SetRuntimeManager sets the runtime manager (for dependency injection)
func (s *WorkspaceService) SetRuntimeManager(rm *RuntimeManager) {
	s.runtimeManager = rm
}

// GetRuntimeManager returns the runtime manager
func (s *WorkspaceService) GetRuntimeManager() *RuntimeManager {
	return s.runtimeManager
}

// SetToolManager sets the tool manager (for dependency injection)
func (s *WorkspaceService) SetToolManager(tm *ToolManager) {
	s.toolManager = tm
}

// SetDockerService sets the docker service on the runtime manager
func (s *WorkspaceService) SetDockerService(ds *DockerService) {
	s.runtimeManager.SetDockerService(ds)
}

// SetSSHPool sets the SSH pool on the runtime manager
func (s *WorkspaceService) SetSSHPool(pool *fs.SSHPool) {
	s.runtimeManager.SetSSHPool(pool)
}

// SetRuntimeStatusService sets the runtime status service on the runtime manager
func (s *WorkspaceService) SetRuntimeStatusService(ss *RuntimeStatusService) {
	s.runtimeManager.SetStatusService(ss)
}

// SetupRuntimeCallbacks sets up callbacks for the runtime manager
func (s *WorkspaceService) SetupRuntimeCallbacks() {
	s.runtimeManager.SetOnContainerCreated(s.updateRuntimeContainerInfo)
}

// SetRepoMapService sets the repo map service for code indexing
func (s *WorkspaceService) SetRepoMapService(svc *repomap.RepoMapService) {
	s.repoMapService = svc
}

// GetRepoMapService returns the repo map service
func (s *WorkspaceService) GetRepoMapService() *repomap.RepoMapService {
	return s.repoMapService
}

// SetFSRegistry sets the filesystem registry
func (s *WorkspaceService) SetFSRegistry(reg *FSRegistry) {
	s.fsRegistry = reg
}

// InitRepoMapForAllWorkspaces initializes repo map indexing for all existing workspaces
func (s *WorkspaceService) InitRepoMapForAllWorkspaces(ctx context.Context) error {
	if s.repoMapService == nil || s.fsRegistry == nil {
		log.Printf("[RepoMap] InitRepoMapForAllWorkspaces: service or registry is nil")
		return nil
	}

	var workspaces []models.Workspace
	if err := s.db.Preload("Runtime").Find(&workspaces).Error; err != nil {
		return err
	}

	log.Printf("[RepoMap] InitRepoMapForAllWorkspaces: found %d workspaces in database", len(workspaces))

	registered := 0
	for _, ws := range workspaces {
		if ws.Runtime == nil {
			log.Printf("[RepoMap] Skipping workspace %s: no runtime", ws.Name)
			continue
		}
		if ws.Runtime.WorkDirPath == "" {
			log.Printf("[RepoMap] Skipping workspace %s: empty workDir path", ws.Name)
			continue
		}
		if err := s.registerWorkspaceRepoMap(ctx, &ws); err != nil {
			log.Printf("[RepoMap] Failed to register workspace %s: %v", ws.ID, err)
		} else {
			registered++
		}
	}

	log.Printf("[RepoMap] Initialized %d of %d workspaces", registered, len(workspaces))
	return nil
}

// registerWorkspaceRepoMap registers a workspace for repo map indexing
func (s *WorkspaceService) registerWorkspaceRepoMap(ctx context.Context, ws *models.Workspace) error {
	if s.repoMapService == nil || s.fsRegistry == nil || ws.Runtime == nil {
		return nil
	}

	var spec EndpointSpec
	var rootPath string

	switch ws.Runtime.Type {
	case models.RuntimeTypeLocal:
		// Local filesystem - no AssetID needed
		spec = EndpointSpec{}
		// Expand ~ to home directory for local filesystem
		rootPath = expandTildePath(ws.Runtime.WorkDirPath)

	case models.RuntimeTypeDockerLocal, models.RuntimeTypeDockerRemote:
		// Docker (local or remote): use container filesystem via Docker API
		// Need container ID to access files
		if ws.Runtime.ContainerID == nil || *ws.Runtime.ContainerID == "" {
			log.Printf("[RepoMap] Skipping docker workspace %s: no container ID (container may not be running)", ws.Name)
			return nil
		}

		// Build endpoint spec for docker container
		spec = EndpointSpec{
			ContainerID: *ws.Runtime.ContainerID,
		}
		// For remote docker, also need the asset ID
		if ws.Runtime.Type == models.RuntimeTypeDockerRemote && ws.Runtime.DockerAssetID != nil {
			spec.AssetID = *ws.Runtime.DockerAssetID
		}

		// Use container path (WorkDirContainerPath), not host path
		if ws.Runtime.WorkDirContainerPath != nil && *ws.Runtime.WorkDirContainerPath != "" {
			rootPath = *ws.Runtime.WorkDirContainerPath
		} else {
			// Fallback to WorkDirPath if container path not set
			rootPath = ws.Runtime.WorkDirPath
		}

	default:
		log.Printf("[RepoMap] Skipping workspace %s: unsupported runtime type %s", ws.Name, ws.Runtime.Type)
		return nil
	}

	// Open filesystem
	fsys, err := s.fsRegistry.Open(ctx, spec)
	if err != nil {
		return fmt.Errorf("failed to open filesystem: %w", err)
	}

	// Create adapter with already-expanded path
	adapter := repomap.NewFSAdapterWithExpandedPath(fsys, rootPath)
	s.repoMapService.RegisterWorkspace(ws.ID, rootPath, adapter)

	log.Printf("[RepoMap] Registered workspace %s (%s) type=%s", ws.Name, rootPath, ws.Runtime.Type)
	return nil
}

// expandTildePath expands ~ to user's home directory
func expandTildePath(path string) string {
	if strings.HasPrefix(path, "~/") {
		home, err := os.UserHomeDir()
		if err == nil {
			return filepath.Join(home, path[2:])
		}
	} else if path == "~" {
		home, err := os.UserHomeDir()
		if err == nil {
			return home
		}
	}
	return path
}

// unregisterWorkspaceRepoMap unregisters a workspace from repo map indexing
func (s *WorkspaceService) unregisterWorkspaceRepoMap(workspaceID string) {
	if s.repoMapService == nil {
		return
	}
	s.repoMapService.UnregisterWorkspace(workspaceID)
}

// updateRuntimeContainerInfo updates the container ID, name, and IP in the database
func (s *WorkspaceService) updateRuntimeContainerInfo(workspaceID, containerID, containerName, containerIP string) error {
	updates := map[string]interface{}{
		"container_id":   containerID,
		"container_name": containerName,
	}
	if containerIP != "" {
		updates["container_ip"] = containerIP
	}
	return s.db.Model(&models.WorkspaceRuntime{}).
		Where("workspace_id = ?", workspaceID).
		Updates(updates).Error
}

// AutoMigrate creates database tables
func (s *WorkspaceService) AutoMigrate() error {
	return s.db.AutoMigrate(
		&models.Workspace{},
		&models.WorkspaceRuntime{},
		&models.WorkspaceAssetRef{},
		&models.WorkspaceTool{},
		&models.WorkspaceAgent{},
		&models.Room{},
	)
}

// validateWorkspaceName checks if a workspace name is valid
func validateWorkspaceName(name string) error {
	if name == "" || len(name) > 63 {
		return ErrWorkspaceNameInvalid
	}
	if !workspaceNameRegex.MatchString(name) {
		return ErrWorkspaceNameInvalid
	}
	return nil
}

// CreateWorkspaceRequest represents a request to create a workspace
type CreateWorkspaceRequest struct {
	Name        string                  `json:"name"`
	Description string                  `json:"description,omitempty"`
	Color       string                  `json:"color,omitempty"`
	Runtime     *CreateRuntimeRequest   `json:"runtime"`
	Assets      []CreateAssetRefRequest `json:"assets,omitempty"`
	Tools       []CreateToolRequest     `json:"tools,omitempty"`
}

// CreateRuntimeRequest represents runtime configuration for creation
type CreateRuntimeRequest struct {
	Type                 models.RuntimeType    `json:"type"`
	DockerAssetID        *string               `json:"docker_asset_id,omitempty"`
	ContainerMode        *models.ContainerMode `json:"container_mode,omitempty"`
	ContainerID          *string               `json:"container_id,omitempty"`
	NewContainerImage    *string               `json:"new_container_image,omitempty"`
	NewContainerName     *string               `json:"new_container_name,omitempty"`
	WorkDirPath          string                `json:"work_dir_path"`
	WorkDirContainerPath *string               `json:"work_dir_container_path,omitempty"`
}

// CreateAssetRefRequest represents asset reference for creation
type CreateAssetRefRequest struct {
	AssetID      string         `json:"asset_id"`
	AssetType    string         `json:"asset_type,omitempty"`
	AssetName    string         `json:"asset_name,omitempty"`
	AIHint       *string        `json:"ai_hint,omitempty"`
	Restrictions models.JSONMap `json:"restrictions,omitempty"`
}

// CreateToolRequest represents tool configuration for creation
type CreateToolRequest struct {
	Name        string          `json:"name"`
	Type        models.ToolType `json:"type"`
	Description *string         `json:"description,omitempty"`
	Enabled     *bool           `json:"enabled,omitempty"`
	Config      models.JSONMap  `json:"config"`
	AIHint      *string         `json:"ai_hint,omitempty"`
}

// Create creates a new workspace
func (s *WorkspaceService) Create(ctx context.Context, req *CreateWorkspaceRequest) (*models.Workspace, error) {
	if err := validateWorkspaceName(req.Name); err != nil {
		return nil, err
	}

	// Check if name exists
	var count int64
	if err := s.db.Model(&models.Workspace{}).Where("name = ?", req.Name).Count(&count).Error; err != nil {
		return nil, err
	}
	if count > 0 {
		return nil, ErrWorkspaceNameExists
	}

	workspace := &models.Workspace{
		ID:          uuid.New().String(),
		Name:        req.Name,
		Description: req.Description,
		Status:      models.WorkspaceStatusStopped,
		Color:       req.Color,
		CreatedAt:   time.Now(),
		UpdatedAt:   time.Now(),
	}

	// Create in transaction
	err := s.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Create(workspace).Error; err != nil {
			return err
		}

		// Create runtime if provided
		if req.Runtime != nil {
			runtime := &models.WorkspaceRuntime{
				ID:                   uuid.New().String(),
				WorkspaceID:          workspace.ID,
				Type:                 req.Runtime.Type,
				DockerAssetID:        req.Runtime.DockerAssetID,
				ContainerMode:        req.Runtime.ContainerMode,
				ContainerID:          req.Runtime.ContainerID,
				NewContainerImage:    req.Runtime.NewContainerImage,
				NewContainerName:     req.Runtime.NewContainerName,
				WorkDirPath:          req.Runtime.WorkDirPath,
				WorkDirContainerPath: req.Runtime.WorkDirContainerPath,
			}
			if err := tx.Create(runtime).Error; err != nil {
				return err
			}
			workspace.Runtime = runtime
		}

		// Create default room
		defaultRoom := &models.Room{
			ID:          uuid.New().String(),
			WorkspaceID: workspace.ID,
			Name:        "Main",
			CreatedAt:   time.Now(),
			UpdatedAt:   time.Now(),
		}
		if err := tx.Create(defaultRoom).Error; err != nil {
			return err
		}
		workspace.ActiveRoomID = defaultRoom.ID
		workspace.Rooms = []models.Room{*defaultRoom}

		// Update workspace with active room
		if err := tx.Model(workspace).Update("active_room_id", defaultRoom.ID).Error; err != nil {
			return err
		}

		// Create assets
		for _, assetReq := range req.Assets {
			asset := &models.WorkspaceAssetRef{
				ID:           uuid.New().String(),
				WorkspaceID:  workspace.ID,
				AssetID:      assetReq.AssetID,
				AssetType:    assetReq.AssetType,
				AssetName:    assetReq.AssetName,
				AIHint:       assetReq.AIHint,
				Restrictions: assetReq.Restrictions,
				CreatedAt:    time.Now(),
			}
			if err := tx.Create(asset).Error; err != nil {
				return err
			}
			workspace.Assets = append(workspace.Assets, *asset)
		}

		// Create tools
		for _, toolReq := range req.Tools {
			enabled := true
			if toolReq.Enabled != nil {
				enabled = *toolReq.Enabled
			}
			tool := &models.WorkspaceTool{
				ID:          uuid.New().String(),
				WorkspaceID: workspace.ID,
				Name:        toolReq.Name,
				Type:        toolReq.Type,
				Description: toolReq.Description,
				Enabled:     enabled,
				Config:      toolReq.Config,
				AIHint:      toolReq.AIHint,
				CreatedAt:   time.Now(),
				UpdatedAt:   time.Now(),
			}
			if err := tx.Create(tool).Error; err != nil {
				return err
			}
			workspace.Tools = append(workspace.Tools, *tool)
		}

		return nil
	})

	if err != nil {
		return nil, err
	}

	// Register workspace for repo map indexing (async, don't block creation)
	go func() {
		if regErr := s.registerWorkspaceRepoMap(context.Background(), workspace); regErr != nil {
			log.Printf("[RepoMap] Failed to register new workspace %s: %v", workspace.ID, regErr)
		}
	}()

	return workspace, nil
}

// Get retrieves a workspace by ID
func (s *WorkspaceService) Get(ctx context.Context, id string) (*models.Workspace, error) {
	var workspace models.Workspace
	err := s.db.
		Preload("Runtime").
		Preload("Assets").
		Preload("Tools").
		Preload("Rooms").
		First(&workspace, "id = ?", id).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrWorkspaceNotFound
		}
		return nil, err
	}
	return &workspace, nil
}

// GetWorkspace retrieves a workspace by ID (implements tools.WorkspaceGetter interface)
func (s *WorkspaceService) GetWorkspace(id string) (*models.Workspace, error) {
	return s.Get(context.Background(), id)
}

// GetByName retrieves a workspace by name
func (s *WorkspaceService) GetByName(ctx context.Context, name string) (*models.Workspace, error) {
	var workspace models.Workspace
	err := s.db.
		Preload("Runtime").
		Preload("Assets").
		Preload("Tools").
		Preload("Rooms").
		First(&workspace, "name = ?", name).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrWorkspaceNotFound
		}
		return nil, err
	}
	return &workspace, nil
}

// WorkspaceFilter represents filter options for listing workspaces
type WorkspaceFilter struct {
	Status *models.WorkspaceStatus `json:"status,omitempty"`
}

// List retrieves all workspaces
func (s *WorkspaceService) List(ctx context.Context, filter *WorkspaceFilter) ([]models.WorkspaceListItem, error) {
	query := s.db.Model(&models.Workspace{}).
		Select("workspaces.*, workspace_runtimes.type as runtime_type, (SELECT COUNT(*) FROM workspace_rooms WHERE workspace_id = workspaces.id) as rooms_count").
		Joins("LEFT JOIN workspace_runtimes ON workspace_runtimes.workspace_id = workspaces.id")

	if filter != nil && filter.Status != nil {
		query = query.Where("workspaces.status = ?", *filter.Status)
	}

	var workspaces []models.WorkspaceListItem
	if err := query.Order("workspaces.created_at DESC").Find(&workspaces).Error; err != nil {
		return nil, err
	}
	return workspaces, nil
}

// UpdateWorkspaceRequest represents a request to update a workspace
type UpdateWorkspaceRequest struct {
	Name        *string                 `json:"name,omitempty"`
	Description *string                 `json:"description,omitempty"`
	Color       *string                 `json:"color,omitempty"`
	Runtime     *CreateRuntimeRequest   `json:"runtime,omitempty"`
	Assets      []CreateAssetRefRequest `json:"assets,omitempty"`
	Tools       []CreateToolRequest     `json:"tools,omitempty"`
}

// Update updates a workspace
func (s *WorkspaceService) Update(ctx context.Context, id string, req *UpdateWorkspaceRequest) (*models.Workspace, error) {
	workspace, err := s.Get(ctx, id)
	if err != nil {
		return nil, err
	}

	// Validate name if changing
	if req.Name != nil && *req.Name != workspace.Name {
		if err := validateWorkspaceName(*req.Name); err != nil {
			return nil, err
		}
		// Check if name exists
		var count int64
		if err := s.db.Model(&models.Workspace{}).Where("name = ? AND id != ?", *req.Name, id).Count(&count).Error; err != nil {
			return nil, err
		}
		if count > 0 {
			return nil, ErrWorkspaceNameExists
		}
	}

	err = s.db.Transaction(func(tx *gorm.DB) error {
		updates := map[string]interface{}{
			"updated_at": time.Now(),
		}
		if req.Name != nil {
			updates["name"] = *req.Name
		}
		if req.Description != nil {
			updates["description"] = *req.Description
		}
		if req.Color != nil {
			updates["color"] = *req.Color
		}

		if err := tx.Model(workspace).Updates(updates).Error; err != nil {
			return err
		}

		// Update runtime if provided
		if req.Runtime != nil {
			if workspace.Runtime != nil {
				// Update existing runtime
				runtimeUpdates := map[string]interface{}{
					"type":                    req.Runtime.Type,
					"docker_asset_id":         req.Runtime.DockerAssetID,
					"container_mode":          req.Runtime.ContainerMode,
					"container_id":            req.Runtime.ContainerID,
					"new_container_image":     req.Runtime.NewContainerImage,
					"new_container_name":      req.Runtime.NewContainerName,
					"work_dir_path":           req.Runtime.WorkDirPath,
					"work_dir_container_path": req.Runtime.WorkDirContainerPath,
				}
				if err := tx.Model(workspace.Runtime).Updates(runtimeUpdates).Error; err != nil {
					return err
				}
			} else {
				// Create new runtime
				runtime := &models.WorkspaceRuntime{
					ID:                   uuid.New().String(),
					WorkspaceID:          workspace.ID,
					Type:                 req.Runtime.Type,
					DockerAssetID:        req.Runtime.DockerAssetID,
					ContainerMode:        req.Runtime.ContainerMode,
					ContainerID:          req.Runtime.ContainerID,
					NewContainerImage:    req.Runtime.NewContainerImage,
					NewContainerName:     req.Runtime.NewContainerName,
					WorkDirPath:          req.Runtime.WorkDirPath,
					WorkDirContainerPath: req.Runtime.WorkDirContainerPath,
				}
				if err := tx.Create(runtime).Error; err != nil {
					return err
				}
			}
		}

		// Update assets if provided (replace all)
		if req.Assets != nil {
			// Delete existing assets
			if err := tx.Where("workspace_id = ?", id).Delete(&models.WorkspaceAssetRef{}).Error; err != nil {
				return err
			}
			// Create new assets
			for _, assetReq := range req.Assets {
				assetRef := &models.WorkspaceAssetRef{
					ID:           uuid.New().String(),
					WorkspaceID:  id,
					AssetID:      assetReq.AssetID,
					AssetType:    assetReq.AssetType,
					AssetName:    assetReq.AssetName,
					AIHint:       assetReq.AIHint,
					Restrictions: assetReq.Restrictions,
					CreatedAt:    time.Now(),
				}
				if err := tx.Create(assetRef).Error; err != nil {
					return err
				}
			}
		}

		// Update tools if provided (replace all)
		if req.Tools != nil {
			// Delete existing tools
			if err := tx.Where("workspace_id = ?", id).Delete(&models.WorkspaceTool{}).Error; err != nil {
				return err
			}
			// Create new tools
			now := time.Now()
			for _, toolReq := range req.Tools {
				enabled := true
				if toolReq.Enabled != nil {
					enabled = *toolReq.Enabled
				}
				tool := &models.WorkspaceTool{
					ID:          uuid.New().String(),
					WorkspaceID: id,
					Name:        toolReq.Name,
					Type:        models.ToolType(toolReq.Type),
					Description: toolReq.Description,
					Enabled:     enabled,
					Config:      toolReq.Config,
					AIHint:      toolReq.AIHint,
					CreatedAt:   now,
					UpdatedAt:   now,
				}
				if err := tx.Create(tool).Error; err != nil {
					return err
				}
			}
		}

		return nil
	})

	if err != nil {
		return nil, err
	}

	return s.Get(ctx, id)
}

// Delete deletes a workspace
func (s *WorkspaceService) Delete(ctx context.Context, id string, force bool) error {
	workspace, err := s.Get(ctx, id)
	if err != nil {
		return err
	}

	if workspace.Status == models.WorkspaceStatusRunning && !force {
		return ErrWorkspaceRunning
	}

	// Stop workspace if running
	if workspace.Status == models.WorkspaceStatusRunning {
		if err := s.Stop(ctx, id, true); err != nil {
			return err
		}
	}

	// Unregister from repo map indexing
	s.unregisterWorkspaceRepoMap(id)

	// Delete workspace (cascades to related tables)
	return s.db.Delete(workspace).Error
}

// Clone clones a workspace
func (s *WorkspaceService) Clone(ctx context.Context, id string, newName string) (*models.Workspace, error) {
	workspace, err := s.Get(ctx, id)
	if err != nil {
		return nil, err
	}

	// Create request from existing workspace
	req := &CreateWorkspaceRequest{
		Name:        newName,
		Description: workspace.Description,
		Color:       workspace.Color,
	}

	if workspace.Runtime != nil {
		req.Runtime = &CreateRuntimeRequest{
			Type:                 workspace.Runtime.Type,
			DockerAssetID:        workspace.Runtime.DockerAssetID,
			ContainerMode:        workspace.Runtime.ContainerMode,
			NewContainerImage:    workspace.Runtime.NewContainerImage,
			WorkDirPath:          workspace.Runtime.WorkDirPath,
			WorkDirContainerPath: workspace.Runtime.WorkDirContainerPath,
		}
	}

	for _, asset := range workspace.Assets {
		req.Assets = append(req.Assets, CreateAssetRefRequest{
			AssetID:      asset.AssetID,
			AIHint:       asset.AIHint,
			Restrictions: asset.Restrictions,
		})
	}

	for _, tool := range workspace.Tools {
		enabled := tool.Enabled
		req.Tools = append(req.Tools, CreateToolRequest{
			Name:        tool.Name,
			Type:        tool.Type,
			Description: tool.Description,
			Enabled:     &enabled,
			Config:      tool.Config,
			AIHint:      tool.AIHint,
		})
	}

	return s.Create(ctx, req)
}

// Start starts a workspace asynchronously
func (s *WorkspaceService) Start(ctx context.Context, id string) error {
	// Quick status check without preloading relations
	var workspace models.Workspace
	if err := s.db.Select("id", "status").First(&workspace, "id = ?", id).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return ErrWorkspaceNotFound
		}
		return err
	}

	if workspace.Status == models.WorkspaceStatusRunning {
		return nil // Already running
	}

	if workspace.Status == models.WorkspaceStatusStarting {
		return nil // Already starting
	}

	// Update status to starting immediately
	if err := s.db.Model(&models.Workspace{}).Where("id = ?", id).Update("status", models.WorkspaceStatusStarting).Error; err != nil {
		return err
	}

	// Start runtime asynchronously in background (fetch full workspace data in goroutine)
	go s.startRuntimeAsync(id)

	return nil
}

// startRuntimeAsync performs the actual runtime start in background
func (s *WorkspaceService) startRuntimeAsync(workspaceID string) {
	ctx := context.Background()

	// Fetch full workspace data in background
	workspace, err := s.Get(ctx, workspaceID)
	if err != nil {
		s.db.Model(&models.Workspace{}).Where("id = ?", workspaceID).Update("status", models.WorkspaceStatusError)
		return
	}

	// Start runtime (container if Docker)
	if s.runtimeManager != nil && workspace.Runtime != nil {
		if err := s.runtimeManager.StartRuntime(ctx, workspace); err != nil {
			s.db.Model(&models.Workspace{}).Where("id = ?", workspaceID).Updates(map[string]interface{}{
				"status": models.WorkspaceStatusError,
			})
			return
		}
	}

	// Initialize tools
	if s.toolManager != nil {
		if err := s.toolManager.InitializeTools(ctx, workspace); err != nil {
			// Log error but don't fail
		}
	}

	// Update status to running
	s.db.Model(&models.Workspace{}).Where("id = ?", workspaceID).Update("status", models.WorkspaceStatusRunning)
}

// Stop stops a workspace asynchronously
func (s *WorkspaceService) Stop(ctx context.Context, id string, force bool) error {
	// Quick status check without preloading relations
	var workspace models.Workspace
	if err := s.db.Select("id", "status").First(&workspace, "id = ?", id).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return ErrWorkspaceNotFound
		}
		return err
	}

	if workspace.Status == models.WorkspaceStatusStopped {
		return nil // Already stopped
	}

	if workspace.Status == models.WorkspaceStatusStopping {
		return nil // Already stopping
	}

	// Update status to stopping immediately
	if err := s.db.Model(&models.Workspace{}).Where("id = ?", id).Update("status", models.WorkspaceStatusStopping).Error; err != nil {
		return err
	}

	// Stop runtime asynchronously in background (fetch full workspace data in goroutine)
	go s.stopRuntimeAsync(id, force)

	return nil
}

// stopRuntimeAsync performs the actual runtime stop in background
func (s *WorkspaceService) stopRuntimeAsync(workspaceID string, force bool) {
	ctx := context.Background()

	// Fetch full workspace data in background
	workspace, err := s.Get(ctx, workspaceID)
	if err != nil {
		s.db.Model(&models.Workspace{}).Where("id = ?", workspaceID).Update("status", models.WorkspaceStatusError)
		return
	}

	// Shutdown tools
	if s.toolManager != nil {
		if err := s.toolManager.ShutdownTools(ctx, workspace.ID); err != nil {
			// Log error but continue
		}
	}

	// Stop runtime
	if s.runtimeManager != nil && workspace.Runtime != nil {
		if err := s.runtimeManager.StopRuntime(ctx, workspace); err != nil {
			if !force {
				s.db.Model(&models.Workspace{}).Where("id = ?", workspaceID).Update("status", models.WorkspaceStatusError)
				return
			}
		}
	}

	// Update status to stopped
	s.db.Model(&models.Workspace{}).Where("id = ?", workspaceID).Update("status", models.WorkspaceStatusStopped)
}

// GetStatus gets the status of a workspace
func (s *WorkspaceService) GetStatus(ctx context.Context, id string) (*WorkspaceStatusResponse, error) {
	workspace, err := s.Get(ctx, id)
	if err != nil {
		return nil, err
	}

	response := &WorkspaceStatusResponse{
		Status: workspace.Status,
	}

	// Get runtime status
	if s.runtimeManager != nil && workspace.Runtime != nil {
		runtimeStatus, err := s.runtimeManager.GetRuntimeStatus(ctx, workspace)
		if err == nil {
			response.Runtime = runtimeStatus
		}

		// Get detailed status if available
		detailedStatus := s.runtimeManager.GetDetailedStatus(workspace.ID)
		if detailedStatus != nil {
			response.RuntimeDetailed = detailedStatus
		}
	}

	// Get tool statuses
	if s.toolManager != nil {
		for _, tool := range workspace.Tools {
			status := s.toolManager.GetToolStatus(ctx, tool.ID)
			response.Tools = append(response.Tools, ToolStatusInfo{
				ID:     tool.ID,
				Name:   tool.Name,
				Status: status.Status,
				Error:  status.Error,
			})
		}
	}

	return response, nil
}

// WorkspaceStatusResponse represents the status response
type WorkspaceStatusResponse struct {
	Status          models.WorkspaceStatus `json:"status"`
	Runtime         *RuntimeStatusInfo     `json:"runtime,omitempty"`
	RuntimeDetailed *RuntimeDetailedStatus `json:"runtime_detailed,omitempty"`
	Tools           []ToolStatusInfo       `json:"tools,omitempty"`
}

// RuntimeStatusInfo represents runtime status info
type RuntimeStatusInfo struct {
	Type            models.RuntimeType `json:"type"`
	ContainerStatus string             `json:"container_status,omitempty"`
	ContainerID     string             `json:"container_id,omitempty"`
	Uptime          int64              `json:"uptime,omitempty"`
}

// ToolStatusInfo represents tool status info
type ToolStatusInfo struct {
	ID     string            `json:"id"`
	Name   string            `json:"name"`
	Status models.ToolStatus `json:"status"`
	Error  string            `json:"error,omitempty"`
}
