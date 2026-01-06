// FileManager Store - TanStack Query based state management for file system
//
// Event handling strategy:
// - Global event subscription for fs events
// - Only refresh directories that contain the changed files
// - Debounced to avoid rapid refreshes

import { useQuery, useQueryClient, QueryClient } from "@tanstack/react-query";
import { fsList } from "../api/fs";
import { eventClient, RECONNECT_EVENT } from "../api/event_hooks";
import { Events, type FSEventData, type TaskEventData } from "../api/events";
import { taskKeys } from "./taskStore";
import type { Task } from "../api/tasks";

// ============================================================================
// Query Keys
// ============================================================================

export const fileManagerKeys = {
  all: ["fileManager"] as const,
  lists: () => [...fileManagerKeys.all, "list"] as const,
  // List key includes assetId (undefined = local), containerId, path, and showHidden
  list: (params: {
    assetId?: string;
    containerId?: string;
    path?: string;
    showHidden?: boolean;
  }) => [...fileManagerKeys.lists(), params] as const,
};

// ============================================================================
// Path Utilities
// ============================================================================

/**
 * Get parent directory of a path.
 * "/home/user/file.txt" -> "/home/user"
 * "/home/user/" -> "/home"
 * "/" -> "/"
 */
function getParentDir(path: string): string {
  if (!path || path === "/") return "/";
  // Remove trailing slash
  const normalized = path.endsWith("/") ? path.slice(0, -1) : path;
  const lastSlash = normalized.lastIndexOf("/");
  if (lastSlash <= 0) return "/";
  return normalized.slice(0, lastSlash);
}

/**
 * Normalize path for comparison (ensure no trailing slash except for root).
 */
function normalizePath(path: string | undefined): string {
  if (!path) return "/";
  if (path === "/") return "/";
  return path.endsWith("/") ? path.slice(0, -1) : path;
}


// ============================================================================
// Global Event Subscription (singleton)
// ============================================================================

let fileManagerEventsInitialized = false;

/**
 * Initialize global file manager event subscriptions.
 * Call this once at app startup.
 */
export function initFileManagerEvents(queryClient: QueryClient) {
  if (fileManagerEventsInitialized) return;
  fileManagerEventsInitialized = true;

  // Debounce per (assetId + path) to avoid rapid refreshes
  const debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();

  /**
   * Invalidate specific directory query for an asset.
   */
  const invalidateDirectory = (assetId: string | undefined, dirPath: string) => {
    const key = `${assetId || "__local__"}:${normalizePath(dirPath)}`;
    const existing = debounceTimers.get(key);
    if (existing) clearTimeout(existing);

    debounceTimers.set(
      key,
      setTimeout(() => {
        debounceTimers.delete(key);
        // Invalidate only the specific directory query
        queryClient.invalidateQueries({
          queryKey: fileManagerKeys.lists(),
          predicate: (query) => {
            const queryKey = query.queryKey as readonly unknown[];
            if (queryKey.length >= 3 && queryKey[0] === "fileManager" && queryKey[1] === "list") {
              const params = queryKey[2] as { assetId?: string; path?: string } | undefined;
              const queryAssetId = params?.assetId || "__local__";
              const queryPath = normalizePath(params?.path);
              // Match if same asset and same directory
              return queryAssetId === (assetId || "__local__") && queryPath === normalizePath(dirPath);
            }
            return false;
          },
        });
      }, 300)
    );
  };

  /**
   * Invalidate all directories for an asset (used for reconnect or bulk operations).
   */
  const invalidateAllForAsset = (assetId: string | undefined) => {
    const key = assetId || "__local__";
    queryClient.invalidateQueries({
      queryKey: fileManagerKeys.lists(),
      predicate: (query) => {
        const queryKey = query.queryKey as readonly unknown[];
        if (queryKey.length >= 3 && queryKey[0] === "fileManager" && queryKey[1] === "list") {
          const params = queryKey[2] as { assetId?: string } | undefined;
          return (params?.assetId || "__local__") === key;
        }
        return false;
      },
    });
  };

  /**
   * Handle fs.created event - refresh the parent directory of the created file.
   */
  const handleFSCreated = (data: FSEventData) => {
    const assetId = data.AssetID || undefined;
    if (data.Path) {
      const parentDir = getParentDir(data.Path);
      invalidateDirectory(assetId, parentDir);
    }
  };

  /**
   * Handle fs.deleted event - refresh the parent directory of the deleted file.
   */
  const handleFSDeleted = (data: FSEventData) => {
    const assetId = data.AssetID || undefined;
    if (data.Path) {
      const parentDir = getParentDir(data.Path);
      invalidateDirectory(assetId, parentDir);
    }
  };

  /**
   * Handle fs.renamed event - refresh both old and new parent directories.
   */
  const handleFSRenamed = (data: FSEventData) => {
    const assetId = data.AssetID || undefined;
    if (data.OldPath) {
      const oldParentDir = getParentDir(data.OldPath);
      invalidateDirectory(assetId, oldParentDir);
    }
    if (data.NewPath) {
      const newParentDir = getParentDir(data.NewPath);
      invalidateDirectory(assetId, newParentDir);
    }
  };

  /**
   * Handle fs.changed event - refresh directories containing the changed files.
   */
  const handleFSChanged = (data: FSEventData) => {
    const assetId = data.AssetID || undefined;
    // If Paths is provided, refresh parent directories of each path
    if (data.Paths && data.Paths.length > 0) {
      const parentDirs = new Set<string>();
      for (const path of data.Paths) {
        parentDirs.add(getParentDir(path));
      }
      for (const dir of parentDirs) {
        invalidateDirectory(assetId, dir);
      }
    } else {
      // No specific paths - refresh all directories for this asset
      invalidateAllForAsset(assetId);
    }
  };

  // Subscribe to fs events with specific handlers
  eventClient.on<FSEventData>(Events.FS_CREATED, handleFSCreated);
  eventClient.on<FSEventData>(Events.FS_DELETED, handleFSDeleted);
  eventClient.on<FSEventData>(Events.FS_RENAMED, handleFSRenamed);
  eventClient.on<FSEventData>(Events.FS_CHANGED, handleFSChanged);

  // Subscribe to task.completed events to refresh file list after transfer
  eventClient.on<TaskEventData>(Events.TASK_COMPLETED, async (data) => {
    if (!data.TaskID) return;

    // Helper to find task and refresh directory
    const processTask = (task: Task | undefined) => {
      if (!task || task.type !== "transfer") return;

      // Extract transfer request from task meta
      const meta = task.meta as {
        request?: {
          from?: { asset_id?: string };
          to?: { asset_id?: string; path?: string };
        };
      } | undefined;
      if (!meta?.request) return;

      const toAssetId = meta.request.to?.asset_id;
      const toPath = meta.request.to?.path;

      // Refresh the destination directory
      if (toPath) {
        invalidateDirectory(toAssetId, toPath);
      } else {
        // Fallback: refresh all directories for the destination asset
        invalidateAllForAsset(toAssetId);
      }
    };

    // Try to get task from cache first
    let allTasks = queryClient.getQueryData<Task[]>(taskKeys.list(50));
    let task = allTasks?.find((t) => t.id === data.TaskID);

    if (task) {
      processTask(task);
      return;
    }

    // Task not in cache (small file completed before cache was populated)
    // Wait a bit for taskStore to refresh, then try again
    await new Promise((resolve) => setTimeout(resolve, 100));

    allTasks = queryClient.getQueryData<Task[]>(taskKeys.list(50));
    task = allTasks?.find((t) => t.id === data.TaskID);

    if (task) {
      processTask(task);
      return;
    }

    // Still not found - fetch fresh task list
    try {
      const { tasksList } = await import("../api/tasks");
      const freshTasks = await tasksList(50);
      task = freshTasks.find((t) => t.id === data.TaskID);
      processTask(task);
    } catch (err) {
      console.warn("[fileManagerStore] Failed to fetch task list for completed task:", err);
    }
  });

  // On reconnect, invalidate all file manager queries
  eventClient.on(RECONNECT_EVENT, () => {
    queryClient.invalidateQueries({ queryKey: fileManagerKeys.all });
  });
}

// ============================================================================
// Hooks
// ============================================================================

export interface UseFSListParams {
  assetId?: string | null;
  containerId?: string | null;
  path?: string;
  showHidden?: boolean;
  enabled?: boolean;
}

/**
 * Hook to fetch and cache directory listing.
 * Automatically refreshes when fs events are received.
 */
export function useFileManagerList(params: UseFSListParams) {
  const { assetId, containerId, path, showHidden = false, enabled = true } = params;
  // Convert null to undefined for API calls
  const normalizedAssetId = assetId ?? undefined;
  const normalizedContainerId = containerId ?? undefined;

  return useQuery({
    queryKey: fileManagerKeys.list({ assetId: normalizedAssetId, containerId: normalizedContainerId, path, showHidden }),
    queryFn: () =>
      fsList({
        assetId: normalizedAssetId,
        containerId: normalizedContainerId,
        path,
        includeHidden: showHidden,
      }),
    enabled,
    staleTime: 1000 * 30, // 30 seconds
  });
}

/**
 * Hook to manually invalidate file manager queries for a specific asset.
 */
export function useInvalidateFileManager() {
  const queryClient = useQueryClient();
  return (assetId?: string) => {
    queryClient.invalidateQueries({
      queryKey: fileManagerKeys.lists(),
      predicate: (query) => {
        const queryKey = query.queryKey as readonly unknown[];
        if (queryKey.length >= 3 && queryKey[0] === "fileManager" && queryKey[1] === "list") {
          const params = queryKey[2] as { assetId?: string } | undefined;
          if (assetId === undefined) {
            // Invalidate all
            return true;
          }
          return params?.assetId === assetId;
        }
        return false;
      },
    });
  };
}

