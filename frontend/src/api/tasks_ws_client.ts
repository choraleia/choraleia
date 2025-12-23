// Shared tasks WebSocket client (singleton).
//
// Goal:
// - Keep a single WS connection alive for the whole app lifecycle.
// - Avoid React StrictMode mount/unmount churn closing sockets.
// - Provide a small subscribe/unsubscribe API for components.
//
// All code and comments must be in English.

import { openTasksWebSocket, type TaskWSEvent } from "./tasks_ws";
import type { TaskListSnapshot, TaskWatchEvent } from "./tasks_ws";
import type { Task } from "./tasks";
import { tasksStore } from "./tasks_store";

type Listener = (ev: TaskWSEvent) => void;

type StateListener = (s: { status: "connecting" | "open" | "closed"; error?: string }) => void;

let ws: WebSocket | null = null;
let listeners = new Set<Listener>();
let stateListeners = new Set<StateListener>();
let reconnectTimer: number | null = null;
let reconnectAttempt = 0;
let manualClose = false;

const RV_STORAGE_KEY = "choraleia:tasks:rv";

function loadStoredRV(): number {
  try {
    const v = Number(window.localStorage.getItem(RV_STORAGE_KEY) || "0");
    return Number.isFinite(v) && v > 0 ? v : 0;
  } catch {
    return 0;
  }
}

function saveStoredRV(rv: number) {
  try {
    if (!Number.isFinite(rv) || rv <= 0) return;
    window.localStorage.setItem(RV_STORAGE_KEY, String(rv));
  } catch {
    // ignore
  }
}

function asTask(x: unknown): Task {
  return x as Task;
}

function notifyState(s: { status: "connecting" | "open" | "closed"; error?: string }) {
  for (const cb of stateListeners) cb(s);
}

function nextBackoffMs(attempt: number): number {
  // 0.5s, 1s, 2s, 4s, 8s, max 10s
  const ms = Math.min(10000, 500 * Math.pow(2, Math.max(0, attempt)));
  // jitter +-20%
  const jitter = ms * 0.2 * (Math.random() * 2 - 1);
  return Math.max(200, Math.floor(ms + jitter));
}

function clearReconnectTimer() {
  if (reconnectTimer === null) return;
  window.clearTimeout(reconnectTimer);
  reconnectTimer = null;
}

function scheduleReconnect(reason?: string) {
  if (manualClose) return;
  if (reconnectTimer !== null) return;

  const delay = nextBackoffMs(reconnectAttempt);
  reconnectAttempt++;
  notifyState({ status: "closed", error: reason ? `${reason} (reconnect in ${delay}ms)` : `reconnect in ${delay}ms` });

  reconnectTimer = window.setTimeout(() => {
    reconnectTimer = null;
    connect();
  }, delay);
}

function connect() {
  if (manualClose) return;
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
    return;
  }

  notifyState({ status: "connecting" });

  const since = Math.max(tasksStore.getState().resourceVersion || 0, loadStoredRV());

  ws = openTasksWebSocket({
    since,
    historyLimit: 100,
    resyncSeconds: 30,
    onOpen: () => {
      reconnectAttempt = 0;
      clearReconnectTimer();
      notifyState({ status: "open" });
    },
    onClose: () => {
      const reason = "ws closed";
      ws = null;
      scheduleReconnect(reason);
    },
    onError: (e) => {
      // Many browsers trigger onerror without details.
      const reason = e instanceof Error ? e.message : "ws error";
      // If it's still connecting, force close to drive onClose.
      try {
        ws?.close();
      } catch {
        // ignore
      }
      ws = null;
      scheduleReconnect(reason);
    },
    onEvent: (ev) => {
      // Fan out raw events.
      for (const cb of listeners) cb(ev);

      // List-watch state machine.
      if (ev.type === "SNAPSHOT") {
        const snap = ev.data as TaskListSnapshot;
        const rv = Number(snap.resourceVersion || 0);
        const active = Array.isArray(snap.active) ? snap.active.map(asTask) : [];
        const history = Array.isArray(snap.history) ? snap.history.map(asTask) : [];
        tasksStore.applySnapshot({ resourceVersion: rv, active, history });
        saveStoredRV(rv);
        return;
      }

      if (ev.type === "BOOKMARK") {
        const rv = Number((ev.data as any)?.resourceVersion || 0);
        if (rv > 0 && rv >= tasksStore.getState().resourceVersion) {
          // Store RV only; no list changes.
          saveStoredRV(rv);
        }
        return;
      }

      if (ev.type === "EVENT") {
        const data = ev.data as TaskWatchEvent;
        const rv = Number((data as any)?.resourceVersion || 0);
        const task = asTask((data as any)?.task);
        tasksStore.applyEvent({ resourceVersion: rv, task });
        saveStoredRV(tasksStore.getState().resourceVersion);
      }
    },
  });
}

export const tasksWSClient = {
  start() {
    manualClose = false;
    connect();
  },

  stop() {
    manualClose = true;
    clearReconnectTimer();
    try {
      ws?.close();
    } catch {
      // ignore
    }
    ws = null;
    notifyState({ status: "closed", error: "stopped" });
  },

  subscribe(cb: Listener) {
    listeners.add(cb);
    // Ensure the connection is started.
    this.start();
    return () => {
      listeners.delete(cb);
    };
  },

  subscribeState(cb: StateListener) {
    stateListeners.add(cb);
    return () => {
      stateListeners.delete(cb);
    };
  },
};
