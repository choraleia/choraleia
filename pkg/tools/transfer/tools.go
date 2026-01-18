// Package transfer provides file transfer tools between workspace and remote assets.
package transfer

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"path"
	"strings"

	"github.com/cloudwego/eino/components/tool"
	"github.com/cloudwego/eino/components/tool/utils"
	"github.com/cloudwego/eino/schema"

	"github.com/choraleia/choraleia/pkg/service"
	fsimpl "github.com/choraleia/choraleia/pkg/service/fs"
	"github.com/choraleia/choraleia/pkg/tools"
)

func init() {
	tools.Register(tools.ToolDefinition{
		ID:          "transfer_upload",
		Name:        "Upload to Remote",
		Description: "Upload a file from workspace to a remote asset",
		Category:    tools.CategoryTransfer,
		Scope:       tools.ScopeBoth,
		Dangerous:   true,
	}, NewUploadTool)

	tools.Register(tools.ToolDefinition{
		ID:          "transfer_download",
		Name:        "Download from Remote",
		Description: "Download a file from a remote asset to workspace",
		Category:    tools.CategoryTransfer,
		Scope:       tools.ScopeBoth,
		Dangerous:   true,
	}, NewDownloadTool)

	tools.Register(tools.ToolDefinition{
		ID:          "transfer_copy",
		Name:        "Copy Between Assets",
		Description: "Copy a file between two remote assets",
		Category:    tools.CategoryTransfer,
		Scope:       tools.ScopeGlobal,
		Dangerous:   true,
	}, NewCopyBetweenAssetsTool)

	tools.Register(tools.ToolDefinition{
		ID:          "transfer_sync",
		Name:        "Sync Directory",
		Description: "Synchronize a directory between workspace and remote asset",
		Category:    tools.CategoryTransfer,
		Scope:       tools.ScopeBoth,
		Dangerous:   true,
	}, NewSyncTool)
}

// getAssetName retrieves the asset name for display
func getAssetName(tc *tools.ToolContext, assetID string) string {
	if assetID == "" {
		return "local"
	}
	asset, err := tc.GetAsset(assetID)
	if err != nil {
		return assetID
	}
	return asset.Name
}

// ---- Upload Tool ----

type UploadInput struct {
	LocalPath    string `json:"local_path"`
	AssetID      string `json:"asset_id"`
	RemotePath   string `json:"remote_path"`
	Overwrite    bool   `json:"overwrite,omitempty"`
	CreateParent bool   `json:"create_parent,omitempty"`
}

func NewUploadTool(tc *tools.ToolContext) tool.InvokableTool {
	return utils.NewTool(&schema.ToolInfo{
		Name: "transfer_upload",
		Desc: "Upload a file from the local workspace to a remote asset (SSH server, docker container).",
		ParamsOneOf: schema.NewParamsOneOfByParams(map[string]*schema.ParameterInfo{
			"local_path":    {Type: schema.String, Required: true, Desc: "Local file path in workspace"},
			"asset_id":      {Type: schema.String, Required: true, Desc: "Target asset ID"},
			"remote_path":   {Type: schema.String, Required: true, Desc: "Remote destination path"},
			"overwrite":     {Type: schema.Boolean, Required: false, Desc: "Overwrite if exists (default: false)"},
			"create_parent": {Type: schema.Boolean, Required: false, Desc: "Create parent directories if needed (default: true)"},
		}),
	}, func(ctx context.Context, input *UploadInput) (string, error) {
		createParent := true
		if input.CreateParent {
			createParent = input.CreateParent
		}

		// Get file info
		localSpec := tc.WorkspaceEndpoint()
		stat, err := tc.Stat(ctx, localSpec, input.LocalPath)
		if err != nil {
			return fmt.Sprintf("Error: local file not found: %v", err), nil
		}
		if stat.IsDir {
			return fmt.Sprintf("Error: source is a directory, use transfer_sync for directory transfer"), nil
		}

		remoteSpec := tc.AssetEndpoint(input.AssetID)

		// Create parent directory if needed
		if createParent {
			parentDir := path.Dir(input.RemotePath)
			if parentDir != "" && parentDir != "/" && parentDir != "." {
				_ = tc.Mkdir(ctx, remoteSpec, parentDir)
			}
		}

		// Read local file
		content, err := tc.ReadFile(ctx, localSpec, input.LocalPath)
		if err != nil {
			return fmt.Sprintf("Error: failed to read local file: %v", err), nil
		}

		// Write to remote
		err = tc.WriteFile(ctx, remoteSpec, input.RemotePath, content)
		if err != nil {
			return fmt.Sprintf("Error: failed to write to remote: %v", err), nil
		}

		return fmt.Sprintf("Successfully uploaded %s (%d bytes) to %s:%s",
			input.LocalPath, len(content), getAssetName(tc, input.AssetID), input.RemotePath), nil
	})
}

// ---- Download Tool ----

type DownloadInput struct {
	AssetID      string `json:"asset_id"`
	RemotePath   string `json:"remote_path"`
	LocalPath    string `json:"local_path"`
	Overwrite    bool   `json:"overwrite,omitempty"`
	CreateParent bool   `json:"create_parent,omitempty"`
}

func NewDownloadTool(tc *tools.ToolContext) tool.InvokableTool {
	return utils.NewTool(&schema.ToolInfo{
		Name: "transfer_download",
		Desc: "Download a file from a remote asset to the local workspace.",
		ParamsOneOf: schema.NewParamsOneOfByParams(map[string]*schema.ParameterInfo{
			"asset_id":      {Type: schema.String, Required: true, Desc: "Source asset ID"},
			"remote_path":   {Type: schema.String, Required: true, Desc: "Remote file path"},
			"local_path":    {Type: schema.String, Required: true, Desc: "Local destination path"},
			"overwrite":     {Type: schema.Boolean, Required: false, Desc: "Overwrite if exists (default: false)"},
			"create_parent": {Type: schema.Boolean, Required: false, Desc: "Create parent directories if needed (default: true)"},
		}),
	}, func(ctx context.Context, input *DownloadInput) (string, error) {
		createParent := true
		if input.CreateParent {
			createParent = input.CreateParent
		}

		remoteSpec := tc.AssetEndpoint(input.AssetID)
		localSpec := tc.WorkspaceEndpoint()

		// Get remote file info
		stat, err := tc.Stat(ctx, remoteSpec, input.RemotePath)
		if err != nil {
			return fmt.Sprintf("Error: remote file not found: %v", err), nil
		}
		if stat.IsDir {
			return fmt.Sprintf("Error: source is a directory, use transfer_sync for directory transfer"), nil
		}

		// Create parent directory if needed
		if createParent {
			parentDir := path.Dir(input.LocalPath)
			if parentDir != "" && parentDir != "/" && parentDir != "." {
				_ = tc.Mkdir(ctx, localSpec, parentDir)
			}
		}

		// Read remote file
		content, err := tc.ReadFile(ctx, remoteSpec, input.RemotePath)
		if err != nil {
			return fmt.Sprintf("Error: failed to read remote file: %v", err), nil
		}

		// Write to local
		err = tc.WriteFile(ctx, localSpec, input.LocalPath, content)
		if err != nil {
			return fmt.Sprintf("Error: failed to write local file: %v", err), nil
		}

		return fmt.Sprintf("Successfully downloaded %s:%s (%d bytes) to %s",
			getAssetName(tc, input.AssetID), input.RemotePath, len(content), input.LocalPath), nil
	})
}

// ---- Copy Between Assets Tool ----

type CopyBetweenInput struct {
	SourceAssetID string `json:"source_asset_id"`
	SourcePath    string `json:"source_path"`
	TargetAssetID string `json:"target_asset_id"`
	TargetPath    string `json:"target_path"`
	Overwrite     bool   `json:"overwrite,omitempty"`
}

func NewCopyBetweenAssetsTool(tc *tools.ToolContext) tool.InvokableTool {
	return utils.NewTool(&schema.ToolInfo{
		Name: "transfer_copy",
		Desc: "Copy a file between two remote assets. Data flows through the local workspace.",
		ParamsOneOf: schema.NewParamsOneOfByParams(map[string]*schema.ParameterInfo{
			"source_asset_id": {Type: schema.String, Required: true, Desc: "Source asset ID"},
			"source_path":     {Type: schema.String, Required: true, Desc: "Source file path"},
			"target_asset_id": {Type: schema.String, Required: true, Desc: "Target asset ID"},
			"target_path":     {Type: schema.String, Required: true, Desc: "Target file path"},
			"overwrite":       {Type: schema.Boolean, Required: false, Desc: "Overwrite if exists (default: false)"},
		}),
	}, func(ctx context.Context, input *CopyBetweenInput) (string, error) {
		sourceSpec := tc.AssetEndpoint(input.SourceAssetID)
		targetSpec := tc.AssetEndpoint(input.TargetAssetID)

		// Get source file info
		stat, err := tc.Stat(ctx, sourceSpec, input.SourcePath)
		if err != nil {
			return fmt.Sprintf("Error: source file not found: %v", err), nil
		}
		if stat.IsDir {
			return fmt.Sprintf("Error: source is a directory, not supported"), nil
		}

		// Read from source
		content, err := tc.ReadFile(ctx, sourceSpec, input.SourcePath)
		if err != nil {
			return fmt.Sprintf("Error: failed to read source: %v", err), nil
		}

		// Create target parent directory
		parentDir := path.Dir(input.TargetPath)
		if parentDir != "" && parentDir != "/" && parentDir != "." {
			_ = tc.Mkdir(ctx, targetSpec, parentDir)
		}

		// Write to target
		err = tc.WriteFile(ctx, targetSpec, input.TargetPath, content)
		if err != nil {
			return fmt.Sprintf("Error: failed to write to target: %v", err), nil
		}

		return fmt.Sprintf("Successfully copied %s:%s (%d bytes) to %s:%s",
			getAssetName(tc, input.SourceAssetID), input.SourcePath,
			len(content),
			getAssetName(tc, input.TargetAssetID), input.TargetPath), nil
	})
}

// ---- Sync Tool ----

type SyncInput struct {
	SourceAssetID string `json:"source_asset_id,omitempty"`
	SourcePath    string `json:"source_path"`
	TargetAssetID string `json:"target_asset_id,omitempty"`
	TargetPath    string `json:"target_path"`
	Delete        bool   `json:"delete,omitempty"`
	DryRun        bool   `json:"dry_run,omitempty"`
}

type SyncResult struct {
	Uploaded   []string `json:"uploaded,omitempty"`
	Downloaded []string `json:"downloaded,omitempty"`
	Deleted    []string `json:"deleted,omitempty"`
	Skipped    []string `json:"skipped,omitempty"`
	Errors     []string `json:"errors,omitempty"`
}

func NewSyncTool(tc *tools.ToolContext) tool.InvokableTool {
	return utils.NewTool(&schema.ToolInfo{
		Name: "transfer_sync",
		Desc: "Synchronize a directory between local workspace and a remote asset. Leave source_asset_id or target_asset_id empty for local workspace.",
		ParamsOneOf: schema.NewParamsOneOfByParams(map[string]*schema.ParameterInfo{
			"source_asset_id": {Type: schema.String, Required: false, Desc: "Source asset ID (empty for local workspace)"},
			"source_path":     {Type: schema.String, Required: true, Desc: "Source directory path"},
			"target_asset_id": {Type: schema.String, Required: false, Desc: "Target asset ID (empty for local workspace)"},
			"target_path":     {Type: schema.String, Required: true, Desc: "Target directory path"},
			"delete":          {Type: schema.Boolean, Required: false, Desc: "Delete files in target not in source (default: false)"},
			"dry_run":         {Type: schema.Boolean, Required: false, Desc: "Show what would be done without actually doing it (default: false)"},
		}),
	}, func(ctx context.Context, input *SyncInput) (string, error) {
		sourceSpec := service.EndpointSpec{}
		if input.SourceAssetID != "" {
			sourceSpec = tc.AssetEndpoint(input.SourceAssetID)
		}

		targetSpec := service.EndpointSpec{}
		if input.TargetAssetID != "" {
			targetSpec = tc.AssetEndpoint(input.TargetAssetID)
		}

		result := SyncResult{}

		// List source directory
		sourceList, err := tc.ListDir(ctx, sourceSpec, input.SourcePath, true)
		if err != nil {
			return fmt.Sprintf("Error: failed to list source directory: %v", err), nil
		}

		// Ensure target directory exists
		if !input.DryRun {
			_ = tc.Mkdir(ctx, targetSpec, input.TargetPath)
		}

		// List target directory (may not exist)
		targetFiles := make(map[string]*fsimpl.FileEntry)
		targetList, err := tc.ListDir(ctx, targetSpec, input.TargetPath, true)
		if err == nil {
			for _, entry := range targetList.Entries {
				targetFiles[entry.Name] = &entry
			}
		}

		// Sync files
		for _, sourceEntry := range sourceList.Entries {
			if sourceEntry.IsDir {
				// Skip directories for now (could implement recursive sync)
				continue
			}

			sourcePath := path.Join(input.SourcePath, sourceEntry.Name)
			targetPath := path.Join(input.TargetPath, sourceEntry.Name)

			targetEntry, exists := targetFiles[sourceEntry.Name]
			delete(targetFiles, sourceEntry.Name)

			// Check if need to copy
			needCopy := !exists ||
				sourceEntry.Size != targetEntry.Size ||
				sourceEntry.ModTime.After(targetEntry.ModTime)

			if !needCopy {
				result.Skipped = append(result.Skipped, sourceEntry.Name)
				continue
			}

			if input.DryRun {
				if input.SourceAssetID == "" {
					result.Uploaded = append(result.Uploaded, sourceEntry.Name+" (dry-run)")
				} else {
					result.Downloaded = append(result.Downloaded, sourceEntry.Name+" (dry-run)")
				}
				continue
			}

			// Copy file
			content, err := tc.ReadFile(ctx, sourceSpec, sourcePath)
			if err != nil {
				result.Errors = append(result.Errors, fmt.Sprintf("%s: read error: %v", sourceEntry.Name, err))
				continue
			}

			err = tc.WriteFile(ctx, targetSpec, targetPath, content)
			if err != nil {
				result.Errors = append(result.Errors, fmt.Sprintf("%s: write error: %v", sourceEntry.Name, err))
				continue
			}

			if input.SourceAssetID == "" {
				result.Uploaded = append(result.Uploaded, sourceEntry.Name)
			} else {
				result.Downloaded = append(result.Downloaded, sourceEntry.Name)
			}
		}

		// Delete extra files in target if requested
		if input.Delete {
			for name := range targetFiles {
				if input.DryRun {
					result.Deleted = append(result.Deleted, name+" (dry-run)")
				} else {
					targetPath := path.Join(input.TargetPath, name)
					err := tc.Remove(ctx, targetSpec, targetPath)
					if err != nil {
						result.Errors = append(result.Errors, fmt.Sprintf("%s: delete error: %v", name, err))
					} else {
						result.Deleted = append(result.Deleted, name)
					}
				}
			}
		}

		// Format output
		var sb strings.Builder
		sb.WriteString(fmt.Sprintf("Sync: %s:%s -> %s:%s\n",
			getAssetName(tc, input.SourceAssetID), input.SourcePath,
			getAssetName(tc, input.TargetAssetID), input.TargetPath))

		if input.DryRun {
			sb.WriteString("(DRY RUN - no changes made)\n")
		}

		output := map[string]interface{}{
			"uploaded":   len(result.Uploaded),
			"downloaded": len(result.Downloaded),
			"deleted":    len(result.Deleted),
			"skipped":    len(result.Skipped),
			"errors":     len(result.Errors),
		}

		if len(result.Uploaded) > 0 {
			output["uploaded_files"] = result.Uploaded
		}
		if len(result.Downloaded) > 0 {
			output["downloaded_files"] = result.Downloaded
		}
		if len(result.Deleted) > 0 {
			output["deleted_files"] = result.Deleted
		}
		if len(result.Errors) > 0 {
			output["error_details"] = result.Errors
		}

		data, _ := json.MarshalIndent(output, "", "  ")
		sb.WriteString(string(data))

		return sb.String(), nil
	})
}

// Helper for file transfer with streaming (for large files)
type transferProgress struct {
	BytesTransferred int64
	TotalBytes       int64
	CurrentFile      string
}

// streamingCopy copies data with progress tracking
func streamingCopy(dst io.Writer, src io.Reader, progress func(int64)) (int64, error) {
	buf := make([]byte, 32*1024) // 32KB buffer
	var total int64
	for {
		n, err := src.Read(buf)
		if n > 0 {
			written, writeErr := dst.Write(buf[:n])
			total += int64(written)
			if progress != nil {
				progress(total)
			}
			if writeErr != nil {
				return total, writeErr
			}
		}
		if err == io.EOF {
			break
		}
		if err != nil {
			return total, err
		}
	}
	return total, nil
}
