// Tunnel Store - TanStack Query based state management for tunnels
//
// Event handling strategy:
// - Global event subscription (not per-hook) to avoid duplicate listeners
// - Tunnel created/deleted → refresh the list
// - Tunnel status changed → update single tunnel in cache

import { useQuery, useMutation, useQueryClient, QueryClient } from "@tanstack/react-query";
import {
  listTunnels,
  getTunnelStats,
  startTunnel,
  stopTunnel,
} from "../api/tunnels";
import type { TunnelInfo, TunnelStats, TunnelListResponse } from "../api/tunnels";
import { eventClient, RECONNECT_EVENT } from "../api/event_hooks";
import { Events, type TunnelEventData } from "../api/events";

// ============================================================================
// Query Keys
// ============================================================================

export const tunnelKeys = {
  all: ["tunnels"] as const,
  lists: () => [...tunnelKeys.all, "list"] as const,
  stats: () => [...tunnelKeys.all, "stats"] as const,
};

// ============================================================================
// Global Event Subscription (singleton)
// ============================================================================

let tunnelEventsInitialized = false;

/**
 * Initialize global tunnel event subscriptions.
 * Call this once at app startup.
 */
export function initTunnelEvents(queryClient: QueryClient) {
  if (tunnelEventsInitialized) return;
  tunnelEventsInitialized = true;

  // On tunnel created/deleted, refresh the list
  eventClient.on(Events.TUNNEL_CREATED, () => {
    queryClient.invalidateQueries({ queryKey: tunnelKeys.all });
  });

  eventClient.on(Events.TUNNEL_DELETED, () => {
    queryClient.invalidateQueries({ queryKey: tunnelKeys.all });
  });

  // On status change, update the specific tunnel in cache directly (no API call)
  eventClient.on<TunnelEventData>(Events.TUNNEL_STATUS_CHANGED, (data) => {
    if (!data.TunnelID) return;

    queryClient.setQueryData<TunnelListResponse>(
      tunnelKeys.lists(),
      (old) => {
        if (!old) return old;

        const tunnels = old.tunnels.map((t) =>
          t.id === data.TunnelID && data.Status
            ? { ...t, status: data.Status as TunnelInfo["status"] }
            : t
        );

        // Recalculate stats
        const stats = calculateStats(tunnels);

        return { tunnels, stats };
      }
    );
  });

  // On reconnect, refresh all tunnel queries
  eventClient.on(RECONNECT_EVENT, () => {
    queryClient.invalidateQueries({ queryKey: tunnelKeys.all });
  });
}

// ============================================================================
// Hooks
// ============================================================================

/**
 * Hook to fetch and cache tunnel list with stats.
 * Event subscriptions are handled globally, not per-hook.
 */
export function useTunnelList() {
  return useQuery({
    queryKey: tunnelKeys.lists(),
    queryFn: listTunnels,
  });
}

/**
 * Hook to get tunnels and stats separately.
 */
export function useTunnels() {
  const { data, isLoading, error } = useTunnelList();

  return {
    tunnels: data?.tunnels ?? [],
    stats: data?.stats ?? {
      total: 0,
      running: 0,
      stopped: 0,
      error: 0,
      total_bytes_sent: 0,
      total_bytes_received: 0,
    },
    loading: isLoading,
    error,
  };
}

/**
 * Hook to get tunnel stats only (lighter weight).
 */
export function useTunnelStats() {

  return useQuery({
    queryKey: tunnelKeys.stats(),
    queryFn: getTunnelStats,
  });
}

/**
 * Hook to start a tunnel.
 * Note: Status change will be notified via WebSocket event.
 */
export function useStartTunnel() {
  return useMutation({
    mutationFn: startTunnel,
    // No need to invalidate - status change event will update cache
  });
}

/**
 * Hook to stop a tunnel.
 * Note: Status change will be notified via WebSocket event.
 */
export function useStopTunnel() {
  return useMutation({
    mutationFn: stopTunnel,
    // No need to invalidate - status change event will update cache
  });
}

/**
 * Hook to manually invalidate tunnel queries.
 */
export function useInvalidateTunnels() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: tunnelKeys.all });
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Calculate tunnel stats from tunnel list.
 */
function calculateStats(tunnels: TunnelInfo[]): TunnelStats {
  let running = 0;
  let stopped = 0;
  let error = 0;
  let total_bytes_sent = 0;
  let total_bytes_received = 0;

  for (const t of tunnels) {
    if (t.status === "running") running++;
    else if (t.status === "stopped") stopped++;
    else if (t.status === "error") error++;
    total_bytes_sent += t.bytes_sent ?? 0;
    total_bytes_received += t.bytes_received ?? 0;
  }

  return {
    total: tunnels.length,
    running,
    stopped,
    error,
    total_bytes_sent,
    total_bytes_received,
  };
}

