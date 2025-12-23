import { getApiUrl } from "./base";

export type TaskType = "transfer";
export type TaskStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "canceled";

export type TaskProgress = {
  total: number;
  done: number;
  unit: string;
  note?: string;
};

export type Task = {
  id: string;
  type: TaskType;
  status: TaskStatus;
  title: string;
  created_at: string;
  started_at?: string;
  ended_at?: string;
  progress: TaskProgress;
  error?: string;
  meta?: any;
};

export interface APIResponse<T> {
  code: number;
  message: string;
  data?: T;
}

export type TransferRequest = {
  from: { type: "local" | "sftp"; asset_id?: string; path: string };
  to: { type: "local" | "sftp"; asset_id?: string; path: string };
  recursive: boolean;
  overwrite: boolean;
};

export async function tasksListActive(): Promise<Task[]> {
  const res = await fetch(getApiUrl("/api/tasks/active"));
  if (!res.ok) throw new Error(`Tasks list failed: ${res.status}`);
  const json = (await res.json()) as APIResponse<Task[]>;
  if (json.code !== 0) throw new Error(json.message || "Tasks list failed");
  return json.data ?? [];
}

export async function tasksListHistory(limit = 50): Promise<Task[]> {
  const url = new URL(getApiUrl("/api/tasks/history"));
  url.searchParams.set("limit", String(limit));
  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`Tasks history failed: ${res.status}`);
  const json = (await res.json()) as APIResponse<Task[]>;
  if (json.code !== 0) throw new Error(json.message || "Tasks history failed");
  return json.data ?? [];
}

export async function tasksCancel(id: string): Promise<void> {
  const res = await fetch(getApiUrl(`/api/tasks/${id}/cancel`), { method: "POST" });
  if (!res.ok) throw new Error(`Task cancel failed: ${res.status}`);
  const json = (await res.json()) as APIResponse<unknown>;
  if (json.code !== 0) throw new Error(json.message || "Task cancel failed");
}

export async function tasksEnqueueTransfer(req: TransferRequest): Promise<Task> {
  const res = await fetch(getApiUrl("/api/tasks/transfer"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
  });
  if (!res.ok) throw new Error(`Enqueue transfer failed: ${res.status}`);
  const json = (await res.json()) as APIResponse<Task>;
  if (json.code !== 0) throw new Error(json.message || "Enqueue transfer failed");
  if (!json.data) throw new Error("Enqueue transfer: empty response");
  return json.data;
}
