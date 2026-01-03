package service

import (
	"context"
	"fmt"
	"io"
	"path"
	"path/filepath"
	"strings"
	"time"

	fsimpl "github.com/choraleia/choraleia/pkg/service/fs"
)

type TransferEndpoint struct {
	AssetID     string `json:"asset_id,omitempty"`     // required for sftp/docker
	ContainerID string `json:"container_id,omitempty"` // required for docker
	Path        string `json:"path"`                   // single path (for destination or legacy single source)
}

// TransferSourceEndpoint represents source with multiple paths
type TransferSourceEndpoint struct {
	AssetID     string   `json:"asset_id,omitempty"`
	ContainerID string   `json:"container_id,omitempty"`
	Paths       []string `json:"paths"` // multiple source paths
}

type TransferRequest struct {
	// New multi-path source (preferred)
	From TransferSourceEndpoint `json:"from"`
	// Destination
	To        TransferEndpoint `json:"to"`
	Recursive bool             `json:"recursive"`
	Overwrite bool             `json:"overwrite"`
}

type TransferTaskMeta struct {
	Request TransferRequest `json:"request"`
}

type TransferTaskService struct {
	tasks *TaskService
	fsReg *FSRegistry
}

func NewTransferTaskService(tasks *TaskService, assetSvc *AssetService) *TransferTaskService {
	return &TransferTaskService{tasks: tasks, fsReg: NewFSRegistry(assetSvc)}
}

func (s *TransferTaskService) EnqueueCopy(req TransferRequest) *Task {
	// Generate descriptive title based on source and destination
	fromDesc := describeSourceEndpoint(req.From)
	toDesc := describeEndpoint(req.To)
	title := fmt.Sprintf("Transfer %s -> %s", fromDesc, toDesc)
	meta := TransferTaskMeta{Request: req}

	return s.tasks.Enqueue("transfer", title, meta, func(ctx context.Context, update func(TaskProgress), setNote func(string)) error {
		return s.runCopy(ctx, req, update, setNote)
	})
}

// describeSourceEndpoint returns a short description for the source endpoint
func describeSourceEndpoint(ep TransferSourceEndpoint) string {
	var base string
	if ep.AssetID != "" {
		if ep.ContainerID != "" {
			base = fmt.Sprintf("docker:%s", ep.ContainerID[:min(8, len(ep.ContainerID))])
		} else {
			base = "remote"
		}
	} else {
		base = "local"
	}
	if len(ep.Paths) > 1 {
		return fmt.Sprintf("%s (%d items)", base, len(ep.Paths))
	}
	return base
}

// describeEndpoint returns a short description for the endpoint
func describeEndpoint(ep TransferEndpoint) string {
	if ep.AssetID != "" {
		if ep.ContainerID != "" {
			return fmt.Sprintf("docker:%s", ep.ContainerID[:min(8, len(ep.ContainerID))])
		}
		return "remote"
	}
	return "local"
}

func (s *TransferTaskService) runCopy(ctx context.Context, req TransferRequest, update func(TaskProgress), setNote func(string)) error {
	fromFS, err := s.fsReg.Open(ctx, EndpointSpec{AssetID: req.From.AssetID, ContainerID: req.From.ContainerID})
	if err != nil {
		return err
	}
	toFS, err := s.fsReg.Open(ctx, EndpointSpec{AssetID: req.To.AssetID, ContainerID: req.To.ContainerID})
	if err != nil {
		return err
	}

	// Get all source paths
	srcPaths := req.From.Paths
	if len(srcPaths) == 0 {
		return fmt.Errorf("no source paths specified")
	}

	return copyMultiplePaths(ctx, fromFS, srcPaths, toFS, req.To.Path, req.Recursive, req.Overwrite, update, setNote)
}

// copyMultiplePaths transfers multiple source paths to destination
func copyMultiplePaths(
	ctx context.Context,
	src fsimpl.FileSystem,
	srcPaths []string,
	dst fsimpl.FileSystem,
	dstRoot string,
	recursive bool,
	overwrite bool,
	update func(TaskProgress),
	setNote func(string),
) error {
	// Check if both src and dst support TarStreamer for bulk transfer
	srcTar, srcOK := src.(fsimpl.TarStreamer)
	dstTar, dstOK := dst.(fsimpl.TarStreamer)
	useTar := srcOK && dstOK

	// First pass: collect items to transfer
	type transferItem struct {
		srcPath string
		dstPath string
		isDir   bool
		size    int64
	}
	var items []transferItem
	var totalFiles int64

	setNote("Preparing transfer...")

	for _, srcPath := range srcPaths {
		st, err := src.Stat(ctx, srcPath)
		if err != nil {
			return fmt.Errorf("failed to stat %s: %w", srcPath, err)
		}

		dstPath := path.Join(strings.TrimSuffix(dstRoot, "/"), st.Name)

		if st.IsDir && recursive {
			if useTar {
				// For tar transfer, add directory as single item without scanning
				// This avoids slow walkFS on remote filesystems
				items = append(items, transferItem{srcPath: srcPath, dstPath: dstPath, isDir: true})
			} else {
				// For file-by-file transfer, we need to walk
				setNote(fmt.Sprintf("Scanning %s...", st.Name))
				walkItems, err := walkFS(ctx, src, srcPath, true)
				if err != nil {
					return fmt.Errorf("failed to scan %s: %w", srcPath, err)
				}
				for _, wi := range walkItems {
					if !wi.isDir {
						totalFiles++
						items = append(items, transferItem{
							srcPath: wi.srcPath,
							dstPath: path.Join(dstPath, wi.rel),
							isDir:   false,
						})
					} else {
						items = append(items, transferItem{
							srcPath: wi.srcPath,
							dstPath: path.Join(dstPath, wi.rel),
							isDir:   true,
						})
					}
				}
			}
		} else if !st.IsDir {
			totalFiles++
			items = append(items, transferItem{srcPath: srcPath, dstPath: dstPath, isDir: false, size: st.Size})
		}
	}

	// Initialize progress
	if useTar {
		// For tar, use bytes as progress unit since we don't know file count
		update(TaskProgress{Total: 0, Done: 0, Unit: "bytes", Note: "Starting transfer..."})
	} else {
		update(TaskProgress{Total: totalFiles, Done: 0, Unit: "files"})
	}

	// Second pass: transfer
	var doneFiles int64
	var doneBytes int64

	for _, item := range items {
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}

		if item.isDir {
			if useTar {
				// Tar transfer for directory
				update(TaskProgress{Total: 0, Done: doneBytes, Unit: "bytes", Note: fmt.Sprintf("Streaming %s...", path.Base(item.srcPath))})

				// Throttle progress updates - every 500ms AND at least 1MB change
				var lastUpdateTime time.Time
				var lastBytes int64
				transferred, err := copyDirectoryViaTarWithProgress(ctx, srcTar, item.srcPath, dstTar, item.dstPath, func(totalBytes int64) {
					now := time.Now()
					timeSinceLastUpdate := now.Sub(lastUpdateTime)
					bytesSinceLastUpdate := totalBytes - lastBytes

					// Update if: 500ms passed AND at least 1MB transferred, OR first update (lastBytes == 0)
					if lastBytes == 0 || (timeSinceLastUpdate >= 500*time.Millisecond && bytesSinceLastUpdate >= 1024*1024) {
						lastUpdateTime = now
						lastBytes = totalBytes
						update(TaskProgress{
							Total: 0,
							Done:  doneBytes + totalBytes,
							Unit:  "bytes",
							Note:  fmt.Sprintf("Streaming %s (%.1f MB)", path.Base(item.srcPath), float64(totalBytes)/(1024*1024)),
						})
					}
				})
				// Final update with actual transferred bytes
				if lastBytes != transferred {
					update(TaskProgress{
						Total: 0,
						Done:  doneBytes + transferred,
						Unit:  "bytes",
						Note:  fmt.Sprintf("Streaming %s (%.1f MB)", path.Base(item.srcPath), float64(transferred)/(1024*1024)),
					})
				}
				if err != nil {
					return fmt.Errorf("tar transfer failed for %s: %w", item.srcPath, err)
				}
				doneBytes += transferred
				update(TaskProgress{Total: 0, Done: doneBytes, Unit: "bytes", Note: fmt.Sprintf("Completed %s", path.Base(item.srcPath))})
			} else {
				// Create directory (non-tar mode)
				_ = dst.MkdirAll(ctx, item.dstPath)
			}
		} else {
			// Single file transfer
			if useTar {
				update(TaskProgress{Total: 0, Done: doneBytes, Unit: "bytes", Note: path.Base(item.srcPath)})
			} else {
				setNote(path.Base(item.srcPath))
			}

			if err := copySingleFile(ctx, src, item.srcPath, dst, item.dstPath, overwrite); err != nil {
				return fmt.Errorf("failed to copy file %s: %w", item.srcPath, err)
			}

			doneFiles++
			doneBytes += item.size

			if useTar {
				update(TaskProgress{Total: 0, Done: doneBytes, Unit: "bytes", Note: path.Base(item.srcPath)})
			} else {
				update(TaskProgress{Total: totalFiles, Done: doneFiles, Unit: "files", Note: path.Base(item.srcPath)})
			}
		}
	}

	return nil
}

// copyDirectoryViaTarWithProgress transfers directory via tar with progress callback
func copyDirectoryViaTarWithProgress(
	ctx context.Context,
	src fsimpl.TarStreamer,
	srcPath string,
	dst fsimpl.TarStreamer,
	dstPath string,
	onProgress func(totalBytes int64),
) (int64, error) {
	tarReader, err := src.TarDirectory(ctx, srcPath)
	if err != nil {
		return 0, fmt.Errorf("failed to create tar stream: %w", err)
	}
	defer tarReader.Close()

	tarWriter, err := dst.UntarToDirectory(ctx, dstPath)
	if err != nil {
		return 0, fmt.Errorf("failed to create untar stream: %w", err)
	}

	// Use progress reader to track bytes transferred
	pr := &progressReader{r: tarReader, onProgress: onProgress}
	written, err := io.Copy(tarWriter, pr)
	closeErr := tarWriter.Close()

	if err != nil {
		return written, fmt.Errorf("tar stream copy failed: %w", err)
	}
	if closeErr != nil {
		return written, fmt.Errorf("tar stream close failed: %w", closeErr)
	}

	return written, nil
}

// progressReader wraps a reader and calls onProgress with cumulative bytes read
type progressReader struct {
	r          io.Reader
	onProgress func(totalBytes int64)
	total      int64
}

func (pr *progressReader) Read(p []byte) (int, error) {
	n, err := pr.r.Read(p)
	if n > 0 {
		pr.total += int64(n)
		if pr.onProgress != nil {
			pr.onProgress(pr.total)
		}
	}
	return n, err
}

// copySingleFile transfers a single file
func copySingleFile(
	ctx context.Context,
	src fsimpl.FileSystem,
	srcPath string,
	dst fsimpl.FileSystem,
	dstPath string,
	overwrite bool,
) error {
	r, err := src.OpenRead(ctx, srcPath)
	if err != nil {
		return fmt.Errorf("failed to read: %w", err)
	}
	defer r.Close()

	_ = dst.MkdirAll(ctx, path.Dir(dstPath))

	w, err := dst.OpenWrite(ctx, dstPath, fsimpl.OpenWriteOptions{Overwrite: overwrite})
	if err != nil {
		return fmt.Errorf("failed to write: %w", err)
	}

	_, copyErr := io.Copy(w, r)
	closeErr := w.Close()

	if copyErr != nil {
		return fmt.Errorf("copy failed: %w", copyErr)
	}
	if closeErr != nil {
		return fmt.Errorf("close failed: %w", closeErr)
	}

	return nil
}

func walkFS(ctx context.Context, fsys fsimpl.FileSystem, root string, recursive bool) ([]walkItem, error) {
	st, err := fsys.Stat(ctx, root)
	if err != nil {
		return nil, err
	}

	items := make([]walkItem, 0, 64)

	var walk func(cur, relBase string) error
	walk = func(cur, relBase string) error {
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}

		data, err := fsys.ListDir(ctx, cur, fsimpl.ListDirOptions{IncludeHidden: true})
		if err != nil {
			return err
		}
		for _, ent := range data.Entries {
			name := ent.Name
			rel := name
			if relBase != "" {
				rel = relBase + "/" + name
			}
			items = append(items, walkItem{srcPath: ent.Path, rel: rel, isDir: ent.IsDir})
			if ent.IsDir && recursive {
				if err := walk(ent.Path, rel); err != nil {
					return err
				}
			}
		}
		return nil
	}

	if st.IsDir {
		items = append(items, walkItem{srcPath: root, rel: "", isDir: true})
		if recursive {
			if err := walk(root, ""); err != nil {
				return nil, err
			}
		}
		return items, nil
	}

	items = append(items, walkItem{srcPath: root, rel: filepath.Base(root), isDir: false})
	return items, nil
}

type walkItem struct {
	srcPath string
	rel     string
	isDir   bool
}
