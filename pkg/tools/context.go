package tools

import (
	"context"
	"fmt"

	"github.com/choraleia/choraleia/pkg/models"
	"github.com/choraleia/choraleia/pkg/service"
	fsimpl "github.com/choraleia/choraleia/pkg/service/fs"
)

// WorkspaceExecutor interface for executing commands in workspace runtime
type WorkspaceExecutor interface {
	Exec(ctx context.Context, workspace *models.Workspace, cmd []string) (string, error)
}

// WorkspaceGetter interface for getting workspace by ID
type WorkspaceGetter interface {
	GetWorkspace(id string) (*models.Workspace, error)
}

// ToolContext provides services and context needed by tools
type ToolContext struct {
	// Services
	FSService         *service.FSService
	AssetService      *service.AssetService
	WorkspaceExecutor WorkspaceExecutor
	WorkspaceGetter   WorkspaceGetter

	// Workspace context (if tool is running in workspace scope)
	WorkspaceID string
}

// NewToolContext creates a new tool context
func NewToolContext(fsSvc *service.FSService, assetSvc *service.AssetService) *ToolContext {
	return &ToolContext{
		FSService:    fsSvc,
		AssetService: assetSvc,
	}
}

// WithWorkspaceServices sets workspace-related services
func (c *ToolContext) WithWorkspaceServices(executor WorkspaceExecutor, getter WorkspaceGetter) *ToolContext {
	c.WorkspaceExecutor = executor
	c.WorkspaceGetter = getter
	return c
}

// WithWorkspace returns a new context with workspace ID set
func (c *ToolContext) WithWorkspace(workspaceID string) *ToolContext {
	return &ToolContext{
		FSService:         c.FSService,
		AssetService:      c.AssetService,
		WorkspaceExecutor: c.WorkspaceExecutor,
		WorkspaceGetter:   c.WorkspaceGetter,
		WorkspaceID:       workspaceID,
	}
}

// GetWorkspace retrieves the current workspace
func (c *ToolContext) GetWorkspace() (*models.Workspace, error) {
	if c.WorkspaceID == "" {
		return nil, fmt.Errorf("no workspace context")
	}
	if c.WorkspaceGetter == nil {
		return nil, fmt.Errorf("workspace getter not configured")
	}
	return c.WorkspaceGetter.GetWorkspace(c.WorkspaceID)
}

// ExecInWorkspace executes a command in the workspace runtime
func (c *ToolContext) ExecInWorkspace(ctx context.Context, cmd []string) (string, error) {
	if c.WorkspaceExecutor == nil {
		return "", fmt.Errorf("workspace executor not configured")
	}
	workspace, err := c.GetWorkspace()
	if err != nil {
		return "", err
	}
	return c.WorkspaceExecutor.Exec(ctx, workspace, cmd)
}

// GetAsset retrieves an asset by ID
func (c *ToolContext) GetAsset(assetID string) (*models.Asset, error) {
	return c.AssetService.GetAsset(assetID)
}

// LocalEndpoint returns an endpoint spec for local filesystem
func (c *ToolContext) LocalEndpoint() service.EndpointSpec {
	return service.EndpointSpec{}
}

// AssetEndpoint returns an endpoint spec for an asset
func (c *ToolContext) AssetEndpoint(assetID string) service.EndpointSpec {
	return service.EndpointSpec{AssetID: assetID}
}

// ListDir lists directory contents
func (c *ToolContext) ListDir(ctx context.Context, spec service.EndpointSpec, path string, all bool) (*fsimpl.ListDirResponse, error) {
	return c.FSService.ListDir(ctx, spec, path, fsimpl.ListDirOptions{IncludeHidden: all})
}

// Stat returns file info
func (c *ToolContext) Stat(ctx context.Context, spec service.EndpointSpec, path string) (*fsimpl.FileEntry, error) {
	return c.FSService.Stat(ctx, spec, path)
}

// ReadFile reads file content
func (c *ToolContext) ReadFile(ctx context.Context, spec service.EndpointSpec, path string) (string, error) {
	return c.FSService.ReadFile(ctx, spec, path)
}

// WriteFile writes content to file
func (c *ToolContext) WriteFile(ctx context.Context, spec service.EndpointSpec, path string, content string) error {
	return c.FSService.WriteFile(ctx, spec, path, content)
}

// Mkdir creates directory
func (c *ToolContext) Mkdir(ctx context.Context, spec service.EndpointSpec, path string) error {
	return c.FSService.Mkdir(ctx, spec, path)
}

// Remove removes file or directory
func (c *ToolContext) Remove(ctx context.Context, spec service.EndpointSpec, path string) error {
	return c.FSService.Remove(ctx, spec, path)
}

// Rename renames/moves file or directory
func (c *ToolContext) Rename(ctx context.Context, spec service.EndpointSpec, from, to string) error {
	return c.FSService.Rename(ctx, spec, from, to)
}

// Copy copies file or directory
func (c *ToolContext) Copy(ctx context.Context, spec service.EndpointSpec, src, dst string) error {
	return c.FSService.Copy(ctx, spec, src, dst)
}
