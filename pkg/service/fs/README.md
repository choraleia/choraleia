# pkg/service/fs

This directory contains filesystem backend implementations used by the unified `/api/fs/*` API.

## Goals

- Keep concrete filesystem backends separated from higher-level services.
- Avoid root-mapping/sandboxing: all paths are absolute POSIX-style.

## Implementations

- `DockerFileSystem`: uses the local `docker` CLI (`docker exec`) to access a container filesystem.

The `service.FSRegistry` is responsible for constructing the correct `service.FileSystem` implementation for a given endpoint type.

