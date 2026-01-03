import { getApiUrl } from "./base";

export interface APIResponse<T> {
  code: number;
  message: string;
  data?: T;
}

export interface FSEntry {
  name: string;
  path: string;
  is_dir: boolean;
  size: number;
  mode: string;
  mod_time: string;
}

export interface FSListResponse {
  path: string;
  entries: FSEntry[];
}

export function fsDownloadUrl(params: {
  assetId?: string;
  containerId?: string;
  path: string;
}): string {
  const url = new URL(getApiUrl("/api/fs/download"));
  if (params.assetId) url.searchParams.set("asset_id", params.assetId);
  if (params.containerId) url.searchParams.set("container_id", params.containerId);
  url.searchParams.set("path", params.path);
  return url.toString();
}

export async function fsList(params: {
  assetId?: string;
  containerId?: string;
  path?: string;
  includeHidden?: boolean;
}): Promise<FSListResponse> {
  const url = new URL(getApiUrl("/api/fs/ls"));
  if (params.assetId) url.searchParams.set("asset_id", params.assetId);
  if (params.containerId) url.searchParams.set("container_id", params.containerId);
  if (params.path) url.searchParams.set("path", params.path);
  if (params.includeHidden) url.searchParams.set("include_hidden", "true");

  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`FS list failed: ${res.status}`);

  const json = (await res.json()) as APIResponse<FSListResponse>;
  if (json.code !== 0) throw new Error(json.message || "FS list failed");
  if (!json.data) throw new Error("FS list: empty response");
  return json.data;
}

export async function fsStat(params: {
  assetId?: string;
  containerId?: string;
  path: string;
}): Promise<FSEntry> {
  const url = new URL(getApiUrl("/api/fs/stat"));
  if (params.assetId) url.searchParams.set("asset_id", params.assetId);
  if (params.containerId) url.searchParams.set("container_id", params.containerId);
  url.searchParams.set("path", params.path);

  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`FS stat failed: ${res.status}`);

  const json = (await res.json()) as APIResponse<FSEntry>;
  if (json.code !== 0) throw new Error(json.message || "FS stat failed");
  if (!json.data) throw new Error("FS stat: empty response");
  return json.data;
}

export async function fsUpload(params: {
  assetId?: string;
  containerId?: string;
  path: string;
  file: File;
  overwrite?: boolean;
}): Promise<void> {
  const url = new URL(getApiUrl("/api/fs/upload"));
  if (params.assetId) url.searchParams.set("asset_id", params.assetId);
  if (params.containerId) url.searchParams.set("container_id", params.containerId);
  url.searchParams.set("path", params.path);
  url.searchParams.set("overwrite", params.overwrite ? "true" : "false");

  const form = new FormData();
  form.append("file", params.file);

  const res = await fetch(url.toString(), { method: "POST", body: form });
  if (!res.ok) throw new Error(`FS upload failed: ${res.status}`);

  const json = (await res.json()) as APIResponse<unknown>;
  if (json.code !== 0) throw new Error(json.message || "FS upload failed");
}

export async function fsMkdir(params: {
  assetId?: string;
  containerId?: string;
  path: string;
}): Promise<void> {
  const url = new URL(getApiUrl("/api/fs/mkdir"));
  if (params.assetId) url.searchParams.set("asset_id", params.assetId);
  if (params.containerId) url.searchParams.set("container_id", params.containerId);
  url.searchParams.set("path", params.path);

  const res = await fetch(url.toString(), { method: "POST" });
  if (!res.ok) throw new Error(`FS mkdir failed: ${res.status}`);

  const json = (await res.json()) as APIResponse<unknown>;
  if (json.code !== 0) throw new Error(json.message || "FS mkdir failed");
}

export async function fsRemove(params: {
  assetId?: string;
  containerId?: string;
  path: string;
}): Promise<void> {
  const url = new URL(getApiUrl("/api/fs/rm"));
  if (params.assetId) url.searchParams.set("asset_id", params.assetId);
  if (params.containerId) url.searchParams.set("container_id", params.containerId);
  url.searchParams.set("path", params.path);

  const res = await fetch(url.toString(), { method: "POST" });
  if (!res.ok) throw new Error(`FS remove failed: ${res.status}`);

  const json = (await res.json()) as APIResponse<unknown>;
  if (json.code !== 0) throw new Error(json.message || "FS remove failed");
}

export async function fsRename(params: {
  assetId?: string;
  containerId?: string;
  from: string;
  to: string;
}): Promise<void> {
  const url = new URL(getApiUrl("/api/fs/rename"));
  if (params.assetId) url.searchParams.set("asset_id", params.assetId);
  if (params.containerId) url.searchParams.set("container_id", params.containerId);
  url.searchParams.set("from", params.from);
  url.searchParams.set("to", params.to);

  const res = await fetch(url.toString(), { method: "POST" });
  if (!res.ok) throw new Error(`FS rename failed: ${res.status}`);

  const json = (await res.json()) as APIResponse<unknown>;
  if (json.code !== 0) throw new Error(json.message || "FS rename failed");
}

/**
 * Create an empty file (touch)
 */
export async function fsTouch(params: {
  assetId?: string;
  containerId?: string;
  path: string;
}): Promise<void> {
  const url = new URL(getApiUrl("/api/fs/touch"));
  if (params.assetId) url.searchParams.set("asset_id", params.assetId);
  if (params.containerId) url.searchParams.set("container_id", params.containerId);
  url.searchParams.set("path", params.path);

  const res = await fetch(url.toString(), { method: "POST" });
  if (!res.ok) throw new Error(`FS touch failed: ${res.status}`);

  const json = (await res.json()) as APIResponse<unknown>;
  if (json.code !== 0) throw new Error(json.message || "FS touch failed");
}

/**
 * Read file content as text
 */
export async function fsRead(params: {
  assetId?: string;
  containerId?: string;
  path: string;
}): Promise<string> {
  const url = new URL(getApiUrl("/api/fs/read"));
  if (params.assetId) url.searchParams.set("asset_id", params.assetId);
  if (params.containerId) url.searchParams.set("container_id", params.containerId);
  url.searchParams.set("path", params.path);

  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`FS read failed: ${res.status}`);

  const json = (await res.json()) as APIResponse<{ content: string }>;
  if (json.code !== 0) throw new Error(json.message || "FS read failed");
  return json.data?.content || "";
}

/**
 * Write content to a file
 */
export async function fsWrite(params: {
  assetId?: string;
  containerId?: string;
  path: string;
  content: string;
}): Promise<void> {
  const url = new URL(getApiUrl("/api/fs/write"));
  if (params.assetId) url.searchParams.set("asset_id", params.assetId);
  if (params.containerId) url.searchParams.set("container_id", params.containerId);

  const res = await fetch(url.toString(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path: params.path, content: params.content }),
  });
  if (!res.ok) throw new Error(`FS write failed: ${res.status}`);

  const json = (await res.json()) as APIResponse<unknown>;
  if (json.code !== 0) throw new Error(json.message || "FS write failed");
}

/**
 * Copy file or directory
 */
export async function fsCopy(params: {
  assetId?: string;
  containerId?: string;
  from: string;
  to: string;
}): Promise<void> {
  const url = new URL(getApiUrl("/api/fs/copy"));
  if (params.assetId) url.searchParams.set("asset_id", params.assetId);
  if (params.containerId) url.searchParams.set("container_id", params.containerId);
  url.searchParams.set("from", params.from);
  url.searchParams.set("to", params.to);

  const res = await fetch(url.toString(), { method: "POST" });
  if (!res.ok) throw new Error(`FS copy failed: ${res.status}`);

  const json = (await res.json()) as APIResponse<unknown>;
  if (json.code !== 0) throw new Error(json.message || "FS copy failed");
}

/**
 * Check if path exists
 */
export async function fsExists(params: {
  assetId?: string;
  containerId?: string;
  path: string;
}): Promise<boolean> {
  try {
    await fsStat(params);
    return true;
  } catch {
    return false;
  }
}

