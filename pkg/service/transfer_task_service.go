package service

import (
	"context"
	"fmt"
	"io"
	"path"
	"path/filepath"
	"strings"

	fsimpl "github.com/choraleia/choraleia/pkg/service/fs"
)

type TransferEndpoint struct {
	AssetID     string `json:"asset_id,omitempty"`     // required for sftp/docker
	ContainerID string `json:"container_id,omitempty"` // required for docker
	Path        string `json:"path"`
}

type TransferRequest struct {
	From      TransferEndpoint `json:"from"`
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
	fromDesc := describeEndpoint(req.From)
	toDesc := describeEndpoint(req.To)
	title := fmt.Sprintf("Transfer %s -> %s", fromDesc, toDesc)
	meta := TransferTaskMeta{Request: req}

	return s.tasks.Enqueue("transfer", title, meta, func(ctx context.Context, update func(TaskProgress), setNote func(string)) error {
		return s.runCopy(ctx, req, update, setNote)
	})
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

	return copyBetweenFS(ctx, fromFS, req.From.Path, toFS, req.To.Path, req.Recursive, req.Overwrite, update, setNote)
}

func copyBetweenFS(
	ctx context.Context,
	src fsimpl.FileSystem,
	srcPath string,
	dst fsimpl.FileSystem,
	dstRoot string,
	recursive bool,
	overwrite bool,
	update func(TaskProgress),
	setNote func(string),
) error {
	items, err := walkFS(ctx, src, srcPath, recursive)
	if err != nil {
		return err
	}

	var total int64
	for _, it := range items {
		if !it.isDir {
			total++
		}
	}
	update(TaskProgress{Total: total, Done: 0, Unit: "files", Note: ""})

	var done int64
	for _, it := range items {
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}

		dstPath := strings.TrimSuffix(dstRoot, "/")
		if dstPath == "" {
			dstPath = "/"
		}
		if it.rel != "" {
			dstPath = path.Join(dstPath, it.rel)
		}

		if it.isDir {
			_ = dst.MkdirAll(ctx, dstPath)
			continue
		}

		setNote(it.rel)

		r, err := src.OpenRead(ctx, it.srcPath)
		if err != nil {
			return err
		}

		_ = dst.MkdirAll(ctx, path.Dir(dstPath))

		w, err := dst.OpenWrite(ctx, dstPath, fsimpl.OpenWriteOptions{Overwrite: overwrite})
		if err != nil {
			_ = r.Close()
			return err
		}

		_, copyErr := io.Copy(w, r)
		_ = w.Close()
		_ = r.Close()
		if copyErr != nil {
			return copyErr
		}

		done++
		update(TaskProgress{Total: total, Done: done, Unit: "files", Note: it.rel})
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
