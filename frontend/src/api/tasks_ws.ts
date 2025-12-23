// Task events over WebSocket.
//
// This is an alternative to SSE for dev environments where proxies make SSE unreliable.
// All code and comments must be in English.

import { getWsUrl, getApiBase } from "./base";

export type TaskStatusMessage = { type: "status"; data: unknown };

export type TaskListSnapshot = {
  resourceVersion: number;
  active: unknown[];
  history: unknown[];
};

export type TaskWatchEvent = {
  type: "ADDED" | "MODIFIED" | "DELETED";
  resourceVersion: number;
  task: unknown;
};

export type TaskWSEvent =
  | { type: "SNAPSHOT"; data: TaskListSnapshot; resync?: boolean; resume?: { since: number; ok: boolean } }
  | { type: "EVENT"; data: TaskWatchEvent }
  | { type: "BOOKMARK"; data: { resourceVersion: number } }
  | TaskStatusMessage
  | { type: string; data?: unknown };

function wsUrlFromApiBase(path: string): string {
  const base = getApiBase();
  if (!base) return getWsUrl(path);
  try {
    const u = new URL(base);
    u.protocol = u.protocol === "https:" ? "wss:" : "ws:";
    u.pathname = "";
    u.search = "";
    u.hash = "";
    return u.toString().replace(/\/+$/, "") + ("/" + String(path || "").replace(/^\/+/, ""));
  } catch {
    return getWsUrl(path);
  }
}

export function tasksWsUrl(opts?: {
  since?: number;
  historyLimit?: number;
  resyncSeconds?: number;
}): string {
  // Prefer connecting to the backend host directly when an API base is configured.
  // This avoids dev proxy issues where WS upgrade may close before establishment.
  const baseUrl = wsUrlFromApiBase("/api/tasks/ws");
  const u = new URL(baseUrl);
  if (opts?.since && opts.since > 0) u.searchParams.set("since", String(opts.since));
  if (typeof opts?.historyLimit === "number") u.searchParams.set("history_limit", String(opts.historyLimit));
  if (typeof opts?.resyncSeconds === "number") u.searchParams.set("resync", String(opts.resyncSeconds));
  const url = u.toString();
  return url;
}

export function openTasksWebSocket(opts: {
  since?: number;
  historyLimit?: number;
  resyncSeconds?: number;
  onEvent: (ev: TaskWSEvent) => void;
  onOpen?: () => void;
  onClose?: () => void;
  onError?: (err: unknown) => void;
}): WebSocket {
  const ws = new WebSocket(
    tasksWsUrl({
      since: opts.since,
      historyLimit: opts.historyLimit,
      resyncSeconds: opts.resyncSeconds,
    }),
  );

  ws.onopen = () => {
    opts.onOpen?.();
  };

  ws.onmessage = (msg) => {
    try {
      const parsed = JSON.parse(String(msg.data)) as TaskWSEvent;
      opts.onEvent(parsed);
    } catch (e) {
      // Ignore malformed events.
      opts.onError?.(e);
    }
  };

  ws.onerror = (e) => {
    opts.onError?.(e);
  };

  ws.onclose = () => {
    opts.onClose?.();
  };

  return ws;
}
