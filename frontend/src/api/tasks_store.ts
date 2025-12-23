// A tiny in-memory task store that supports Kubernetes-style list-watch.
// All code and comments must be in English.

import type { Task } from "./tasks";

export type TaskStoreState = {
  resourceVersion: number;
  active: Task[];
  history: Task[];
  lastSnapshotAt: number;
};

export type TaskStoreListener = (s: TaskStoreState) => void;

let state: TaskStoreState = {
  resourceVersion: 0,
  active: [],
  history: [],
  lastSnapshotAt: 0,
};

const listeners = new Set<TaskStoreListener>();

function emit() {
  for (const cb of listeners) cb(state);
}

function sortByCreatedAtDesc(tasks: Task[]): Task[] {
  return [...tasks].sort((a, b) => {
    const ta = Date.parse(a.created_at || "") || 0;
    const tb = Date.parse(b.created_at || "") || 0;
    return tb - ta;
  });
}

function isActiveStatus(s: string): boolean {
  return s === "running" || s === "queued";
}

export const tasksStore = {
  getState(): TaskStoreState {
    return state;
  },

  subscribe(cb: TaskStoreListener): () => void {
    listeners.add(cb);
    // Immediate emit so UI can render without waiting for the next WS message.
    cb(state);
    return () => {
      listeners.delete(cb);
    };
  },

  applySnapshot(payload: {
    resourceVersion: number;
    active: Task[];
    history: Task[];
  }) {
    state = {
      resourceVersion: payload.resourceVersion ?? state.resourceVersion,
      active: payload.active ?? [],
      history: payload.history ?? [],
      lastSnapshotAt: Date.now(),
    };
    emit();
  },

  applyEvent(payload: { resourceVersion: number; task: Task }) {
    const rv = payload.resourceVersion ?? state.resourceVersion;
    const t = payload.task;
    if (!t?.id) return;

    // Ignore stale events.
    if (rv > 0 && rv < state.resourceVersion) return;

    const activeById = new Map(state.active.map((x) => [x.id, x] as const));
    const historyById = new Map(state.history.map((x) => [x.id, x] as const));

    if (isActiveStatus(t.status)) {
      activeById.set(t.id, t);
      historyById.delete(t.id);
    } else {
      activeById.delete(t.id);
      historyById.set(t.id, t);
    }

    state = {
      ...state,
      resourceVersion: Math.max(state.resourceVersion, rv),
      active: sortByCreatedAtDesc(Array.from(activeById.values())),
      history: sortByCreatedAtDesc(Array.from(historyById.values())),
    };
    emit();
  },
};

