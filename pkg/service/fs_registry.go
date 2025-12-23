package service

import (
	"context"
	"fmt"
	"strings"

	"github.com/choraleia/choraleia/pkg/models"
	fsimpl "github.com/choraleia/choraleia/pkg/service/fs"
)

// EndpointType identifies a filesystem implementation.
// It is intentionally aligned with TransferEndpointType.
type EndpointType string

const (
	EndpointLocal  EndpointType = "local"
	EndpointSFTP   EndpointType = "sftp"
	EndpointDocker EndpointType = "docker"
	EndpointK8sPod EndpointType = "k8s_pod"
)

type EndpointSpec struct {
	Type    EndpointType
	AssetID string // required for remote FS (e.g. sftp)
}

// FSRegistry builds FileSystem instances for endpoints.
//
// Keeping this in the service package avoids import cycles and allows using
// shared pools/caches owned by filesystem implementations (e.g. SFTPPool).
type FSRegistry struct {
	local     fsimpl.FileSystem
	sftpPool  *fsimpl.SFTPPool
	dockerCLI *fsimpl.DockerCLI
	assetSvc  *AssetService
}

// Ensure local is always the fs implementation, not the removed LocalFSService.
func NewFSRegistry(assetSvc *AssetService) *FSRegistry {
	return &FSRegistry{
		local:     fsimpl.NewLocalFileSystem(),
		sftpPool:  fsimpl.NewSFTPPool(assetSvc),
		dockerCLI: fsimpl.NewDockerCLI(),
		assetSvc:  assetSvc,
	}
}

func (r *FSRegistry) Open(ctx context.Context, spec EndpointSpec) (fsimpl.FileSystem, error) {
	_ = ctx
	switch spec.Type {
	case EndpointLocal:
		return r.local, nil
	case EndpointSFTP:
		if strings.TrimSpace(spec.AssetID) == "" {
			return nil, fmt.Errorf("asset_id is required for sftp")
		}
		return fsimpl.NewSFTPEndpointFileSystem(r.sftpPool, spec.AssetID)
	case EndpointDocker:
		if strings.TrimSpace(spec.AssetID) == "" {
			return nil, fmt.Errorf("asset_id is required for docker")
		}
		asset, err := r.assetSvc.GetAsset(spec.AssetID)
		if err != nil {
			return nil, err
		}
		if asset.Type != models.AssetTypeDocker {
			return nil, fmt.Errorf("asset is not docker")
		}
		fs, err := fsimpl.NewDockerFileSystem(r.dockerCLI, asset)
		if err != nil {
			return nil, err
		}
		return fs, nil
	case EndpointK8sPod:
		return nil, fmt.Errorf("k8s pod filesystem is not implemented yet")
	default:
		return nil, fmt.Errorf("unknown filesystem endpoint: %s", spec.Type)
	}
}
