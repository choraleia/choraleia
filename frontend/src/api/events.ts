// Business Events - Application-specific event definitions and hooks
//
// This file contains all business-related event names, types, and specialized hooks.

import { type QueryKey } from "@tanstack/react-query";
import { type EventName, type EventData } from "./event_client";
import { useInvalidateOnEvent, useOnEvent, useOnEventWithData, type InvalidateOptions } from "./event_hooks";

// ============================================================================
// Event Names
// ============================================================================

export const Events = {
  // Filesystem
  FS_CHANGED: "fs.changed",
  FS_CREATED: "fs.created",
  FS_DELETED: "fs.deleted",
  FS_RENAMED: "fs.renamed",
  // Assets
  ASSET_CREATED: "asset.created",
  ASSET_UPDATED: "asset.updated",
  ASSET_DELETED: "asset.deleted",
  // Tunnels
  TUNNEL_CREATED: "tunnel.created",
  TUNNEL_STATUS_CHANGED: "tunnel.statusChanged",
  TUNNEL_DELETED: "tunnel.deleted",
  // Containers
  CONTAINER_STATUS_CHANGED: "container.statusChanged",
  CONTAINER_LIST_CHANGED: "container.listChanged",
  // Tasks
  TASK_CREATED: "task.created",
  TASK_PROGRESS: "task.progress",
  TASK_COMPLETED: "task.completed",
  // Agent
  AGENT_HEARTBEAT: "agent.heartbeat",
  AGENT_METRICS: "agent.metrics",
  AGENT_DISCONNECTED: "agent.disconnected",
  // System
  CONFIG_CHANGED: "system.configChanged",
} as const;

// ============================================================================
// Event Data Types
// ============================================================================

export interface FSEventData extends EventData {
  AssetID: string;
  Path?: string;
  Paths?: string[];
  OldPath?: string;
  NewPath?: string;
  IsDir?: boolean;
}

export interface AssetEventData extends EventData {
  AssetID: string;
}

export interface TunnelEventData extends EventData {
  TunnelID: string;
  AssetID?: string;
  Status?: string;
}

export interface ContainerEventData extends EventData {
  AssetID: string;
  ContainerID?: string;
  Status?: string;
}

export interface TaskEventData extends EventData {
  TaskID: string;
  TaskType?: string;
  Success?: boolean;
  // Progress fields (for task.progress events)
  Total?: number;
  Done?: number;
  Unit?: string;
  Note?: string;
}

export interface AgentEventData extends EventData {
  AgentID: string;
}

// ============================================================================
// Event Groups (for convenience)
// ============================================================================

export const EventGroups = {
  FS: [Events.FS_CHANGED, Events.FS_CREATED, Events.FS_DELETED, Events.FS_RENAMED] as EventName[],
  ASSET: [Events.ASSET_CREATED, Events.ASSET_UPDATED, Events.ASSET_DELETED] as EventName[],
  // All tunnel events
  TUNNEL: [Events.TUNNEL_CREATED, Events.TUNNEL_STATUS_CHANGED, Events.TUNNEL_DELETED] as EventName[],
  // Only list-changing tunnel events (add/remove)
  TUNNEL_LIST: [Events.TUNNEL_CREATED, Events.TUNNEL_DELETED] as EventName[],
  // Only status change events (start/stop/error)
  TUNNEL_STATUS: [Events.TUNNEL_STATUS_CHANGED] as EventName[],
  CONTAINER: [Events.CONTAINER_STATUS_CHANGED, Events.CONTAINER_LIST_CHANGED] as EventName[],
  // All task events
  TASK: [Events.TASK_CREATED, Events.TASK_PROGRESS, Events.TASK_COMPLETED] as EventName[],
  // Only list-changing task events (created/completed moves between active/history)
  TASK_LIST: [Events.TASK_CREATED, Events.TASK_COMPLETED] as EventName[],
  // Only progress update events
  TASK_PROGRESS: [Events.TASK_PROGRESS] as EventName[],
  AGENT: [Events.AGENT_HEARTBEAT, Events.AGENT_METRICS, Events.AGENT_DISCONNECTED] as EventName[],
};

// ============================================================================
// Specialized Invalidation Hooks
// ============================================================================

/**
 * Invalidate queries when filesystem events fire for a specific asset.
 */
export function useInvalidateOnFSChange(
  assetId: string | undefined,
  queryKey: QueryKey,
  throttle?: number
) {
  useInvalidateOnEvent<FSEventData>(EventGroups.FS, queryKey, {
    throttle,
    filter: (data) => data.AssetID === assetId,
  });
}

/**
 * Invalidate queries when asset events fire.
 */
export function useInvalidateOnAssetChange(queryKey: QueryKey, throttle?: number) {
  useInvalidateOnEvent(EventGroups.ASSET, queryKey, { throttle });
}

/**
 * Invalidate queries when tunnel events fire.
 */
export function useInvalidateOnTunnelChange(queryKey: QueryKey, throttle?: number) {
  useInvalidateOnEvent(EventGroups.TUNNEL, queryKey, { throttle });
}

/**
 * Invalidate queries only when tunnel list changes (created/deleted).
 * Use this for refreshing the tunnel list.
 */
export function useInvalidateOnTunnelListChange(queryKey: QueryKey, throttle?: number) {
  useInvalidateOnEvent(EventGroups.TUNNEL_LIST, queryKey, { throttle });
}

/**
 * Subscribe to tunnel status changes with tunnel data.
 * Use this for updating individual tunnel status in cache.
 */
export function useOnTunnelStatusChange(
  onEvent: (data: TunnelEventData, event: EventName) => void
) {
  useOnEventWithData<TunnelEventData>(EventGroups.TUNNEL_STATUS, onEvent);
}

/**
 * Invalidate queries when container events fire for a specific asset.
 */
export function useInvalidateOnContainerChange(
  assetId: string | undefined,
  queryKey: QueryKey,
  throttle?: number
) {
  useInvalidateOnEvent<ContainerEventData>(EventGroups.CONTAINER, queryKey, {
    throttle,
    filter: (data) => data.AssetID === assetId,
  });
}

/**
 * Invalidate queries when task events fire.
 */
export function useInvalidateOnTaskChange(queryKey: QueryKey, throttle?: number) {
  useInvalidateOnEvent(EventGroups.TASK, queryKey, { throttle });
}

/**
 * Invalidate queries only when task list changes (created/completed).
 * Use this for refreshing the task list.
 */
export function useInvalidateOnTaskListChange(queryKey: QueryKey, throttle?: number) {
  useInvalidateOnEvent(EventGroups.TASK_LIST, queryKey, { throttle });
}

/**
 * Subscribe to task progress changes with task data.
 * Use this for updating individual task progress in cache.
 */
export function useOnTaskProgressChange(
  onEvent: (data: TaskEventData, event: EventName) => void
) {
  useOnEventWithData<TaskEventData>(EventGroups.TASK_PROGRESS, onEvent);
}

/**
 * Subscribe to task completion events with task data.
 * Use this for handling task completion (success/failure).
 */
export function useOnTaskCompleted(
  onEvent: (data: TaskEventData, event: EventName) => void
) {
  useOnEventWithData<TaskEventData>([Events.TASK_COMPLETED], onEvent);
}

// ============================================================================
// Specialized Callback Hooks
// ============================================================================

/**
 * Call a function when FS events fire for a specific asset.
 */
export function useOnFSChange(
  assetId: string | undefined,
  onEvent: () => void,
  throttle?: number
) {
  useOnEvent<FSEventData>(EventGroups.FS, onEvent, {
    throttle,
    filter: (data) => data.AssetID === assetId,
  });
}

/**
 * Call a function when container events fire for a specific asset.
 */
export function useOnContainerChange(
  assetId: string | undefined,
  onEvent: () => void,
  throttle?: number
) {
  useOnEvent<ContainerEventData>(EventGroups.CONTAINER, onEvent, {
    throttle,
    filter: (data) => data.AssetID === assetId,
  });
}

