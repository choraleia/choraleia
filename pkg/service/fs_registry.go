package service

import (
	"context"
	"fmt"
	"strings"

	"github.com/choraleia/choraleia/pkg/models"
	fsimpl "github.com/choraleia/choraleia/pkg/service/fs"
)

// Re-export types from fs package for convenience
type EndpointType = fsimpl.EndpointType
type EndpointSpec = fsimpl.EndpointSpec

const (
	EndpointLocal           = fsimpl.EndpointLocal
	EndpointSFTP            = fsimpl.EndpointSFTP
	EndpointDockerContainer = fsimpl.EndpointDockerContainer
	EndpointK8sPod          = fsimpl.EndpointK8sPod
)

// FSRegistry builds FileSystem instances for endpoints.
type FSRegistry struct {
	local    fsimpl.FileSystem
	sshPool  *fsimpl.SSHPool
	assetSvc *AssetService
}

func NewFSRegistry(assetSvc *AssetService) *FSRegistry {
	return &FSRegistry{
		local:    fsimpl.NewLocalFileSystem(),
		sshPool:  fsimpl.NewSSHPool(assetSvc),
		assetSvc: assetSvc,
	}
}

// ResolveEndpointType determines the endpoint type from asset.
// Priority: container_id present > inferred from asset > local
func (r *FSRegistry) ResolveEndpointType(spec EndpointSpec) (EndpointType, error) {
	// If container ID is provided, assume docker
	if strings.TrimSpace(spec.ContainerID) != "" {
		return EndpointDockerContainer, nil
	}

	// If no asset ID, default to local
	if strings.TrimSpace(spec.AssetID) == "" {
		return EndpointLocal, nil
	}

	// Infer type from asset
	asset, err := r.assetSvc.GetAsset(spec.AssetID)
	if err != nil {
		return "", fmt.Errorf("failed to get asset: %w", err)
	}

	switch asset.Type {
	case models.AssetTypeSSH:
		return EndpointSFTP, nil
	case models.AssetTypeDockerHost:
		return EndpointDockerContainer, nil
	case models.AssetTypeLocal:
		return EndpointLocal, nil
	default:
		return "", fmt.Errorf("unsupported asset type for filesystem: %s", asset.Type)
	}
}

// Open creates a FileSystem instance based on the endpoint.
func (r *FSRegistry) Open(ctx context.Context, spec EndpointSpec) (fsimpl.FileSystem, error) {
	_ = ctx

	typ, err := r.ResolveEndpointType(spec)
	if err != nil {
		return nil, err
	}

	switch typ {
	case EndpointLocal:
		return r.local, nil

	case EndpointSFTP:
		if strings.TrimSpace(spec.AssetID) == "" {
			return nil, fmt.Errorf("asset_id is required for sftp")
		}
		return fsimpl.NewSFTPEndpointFileSystem(r.sshPool, spec.AssetID)

	case EndpointDockerContainer:
		if strings.TrimSpace(spec.ContainerID) == "" {
			return nil, fmt.Errorf("container_id is required for docker filesystem")
		}

		// Get docker host config
		var user string
		var executor fsimpl.DockerExecutor

		if strings.TrimSpace(spec.AssetID) != "" {
			asset, err := r.assetSvc.GetAsset(spec.AssetID)
			if err != nil {
				return nil, fmt.Errorf("failed to get docker host asset: %w", err)
			}
			if asset.Type != models.AssetTypeDockerHost {
				return nil, fmt.Errorf("asset is not a docker host")
			}

			var cfg models.DockerHostConfig
			if err := asset.GetTypedConfig(&cfg); err != nil {
				return nil, fmt.Errorf("invalid docker host config: %w", err)
			}
			user = cfg.User

			if cfg.ConnectionType == "ssh" && cfg.SSHAssetID != "" {
				// Remote Docker via SSH - get SSH client from pool
				sshClient, err := r.sshPool.GetSSHClient(cfg.SSHAssetID)
				if err != nil {
					return nil, fmt.Errorf("failed to get SSH connection for remote docker: %w", err)
				}
				executor = fsimpl.NewRemoteDockerCLI(sshClient)
			} else {
				// Local Docker
				executor = fsimpl.NewLocalDockerCLI()
			}
		} else {
			// No asset ID, assume local docker
			executor = fsimpl.NewLocalDockerCLI()
		}

		return fsimpl.NewDockerContainerFileSystem(executor, spec.ContainerID, user)

	case EndpointK8sPod:
		return nil, fmt.Errorf("k8s pod filesystem is not implemented yet")

	default:
		return nil, fmt.Errorf("unknown filesystem endpoint: %s", typ)
	}
}
