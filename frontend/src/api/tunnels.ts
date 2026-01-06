// Tunnel API - HTTP API functions for tunnel management

import { getApiUrl } from "./base";

// ============================================================================
// Types
// ============================================================================

export interface TunnelInfo {
  id: string;
  asset_id: string;
  asset_name: string;
  type: "local" | "remote" | "dynamic";
  local_host: string;
  local_port: number;
  remote_host?: string;
  remote_port?: number;
  status: "running" | "stopped" | "error";
  error_message?: string;
  bytes_sent?: number;
  bytes_received?: number;
  connections?: number;
  started_at?: string;
}

export interface TunnelStats {
  total: number;
  running: number;
  stopped: number;
  error: number;
  total_bytes_sent: number;
  total_bytes_received: number;
}

export interface TunnelListResponse {
  tunnels: TunnelInfo[];
  stats: TunnelStats;
}

interface APIResponse<T> {
  code: number;
  message: string;
  data?: T;
}

// ============================================================================
// API Functions
// ============================================================================

/**
 * List all tunnels with stats
 */
export async function listTunnels(): Promise<TunnelListResponse> {
  const resp = await fetch(getApiUrl("/api/tunnels"));
  if (!resp.ok) {
    throw new Error(`List tunnels failed: HTTP ${resp.status}`);
  }
  const json = (await resp.json()) as APIResponse<TunnelListResponse>;
  if (json.code !== 200) {
    throw new Error(json.message || "List tunnels failed");
  }
  return json.data ?? { tunnels: [], stats: { total: 0, running: 0, stopped: 0, error: 0, total_bytes_sent: 0, total_bytes_received: 0 } };
}

/**
 * Get tunnel stats only
 */
export async function getTunnelStats(): Promise<TunnelStats> {
  const resp = await fetch(getApiUrl("/api/tunnels/stats"));
  if (!resp.ok) {
    throw new Error(`Get tunnel stats failed: HTTP ${resp.status}`);
  }
  const json = (await resp.json()) as APIResponse<TunnelStats>;
  if (json.code !== 200) {
    throw new Error(json.message || "Get tunnel stats failed");
  }
  return json.data ?? { total: 0, running: 0, stopped: 0, error: 0, total_bytes_sent: 0, total_bytes_received: 0 };
}

/**
 * Start a tunnel
 */
export async function startTunnel(tunnelId: string): Promise<void> {
  const resp = await fetch(getApiUrl(`/api/tunnels/${tunnelId}/start`), {
    method: "POST",
  });
  if (!resp.ok) {
    throw new Error(`Start tunnel failed: HTTP ${resp.status}`);
  }
  const json = (await resp.json()) as APIResponse<unknown>;
  if (json.code !== 200) {
    throw new Error(json.message || "Start tunnel failed");
  }
}

/**
 * Stop a tunnel
 */
export async function stopTunnel(tunnelId: string): Promise<void> {
  const resp = await fetch(getApiUrl(`/api/tunnels/${tunnelId}/stop`), {
    method: "POST",
  });
  if (!resp.ok) {
    throw new Error(`Stop tunnel failed: HTTP ${resp.status}`);
  }
  const json = (await resp.json()) as APIResponse<unknown>;
  if (json.code !== 200) {
    throw new Error(json.message || "Stop tunnel failed");
  }
}

