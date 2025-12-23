import { getApiUrl } from "./base";

export interface APIResponse<T> {
  code: number;
  message: string;
  data?: T;
}

export type FSEndpointType = "local" | "sftp" | "docker" | "k8s_pod";

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
  type: FSEndpointType;
  assetId?: string;
  path: string;
}): string {
  const url = new URL(getApiUrl("/api/fs/download"));
  url.searchParams.set("type", params.type);
  if (params.assetId) url.searchParams.set("asset_id", params.assetId);
  url.searchParams.set("path", params.path);
  return url.toString();
}

export async function fsList(params: {
  type: FSEndpointType;
  assetId?: string;
  path?: string;
  includeHidden?: boolean;
}): Promise<FSListResponse> {
  const url = new URL(getApiUrl("/api/fs/ls"));
  url.searchParams.set("type", params.type);
  if (params.assetId) url.searchParams.set("asset_id", params.assetId);
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
  type: FSEndpointType;
  assetId?: string;
  path: string;
}): Promise<FSEntry> {
  const url = new URL(getApiUrl("/api/fs/stat"));
  url.searchParams.set("type", params.type);
  if (params.assetId) url.searchParams.set("asset_id", params.assetId);
  url.searchParams.set("path", params.path);

  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`FS stat failed: ${res.status}`);

  const json = (await res.json()) as APIResponse<FSEntry>;
  if (json.code !== 0) throw new Error(json.message || "FS stat failed");
  if (!json.data) throw new Error("FS stat: empty response");
  return json.data;
}

export async function fsUpload(params: {
  type: FSEndpointType;
  assetId?: string;
  path: string;
  file: File;
  overwrite?: boolean;
}): Promise<void> {
  const url = new URL(getApiUrl("/api/fs/upload"));
  url.searchParams.set("type", params.type);
  if (params.assetId) url.searchParams.set("asset_id", params.assetId);
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
  type: FSEndpointType;
  assetId?: string;
  path: string;
}): Promise<void> {
  const url = new URL(getApiUrl("/api/fs/mkdir"));
  url.searchParams.set("type", params.type);
  if (params.assetId) url.searchParams.set("asset_id", params.assetId);
  url.searchParams.set("path", params.path);

  const res = await fetch(url.toString(), { method: "POST" });
  if (!res.ok) throw new Error(`FS mkdir failed: ${res.status}`);

  const json = (await res.json()) as APIResponse<unknown>;
  if (json.code !== 0) throw new Error(json.message || "FS mkdir failed");
}

export async function fsRemove(params: {
  type: FSEndpointType;
  assetId?: string;
  path: string;
}): Promise<void> {
  const url = new URL(getApiUrl("/api/fs/rm"));
  url.searchParams.set("type", params.type);
  if (params.assetId) url.searchParams.set("asset_id", params.assetId);
  url.searchParams.set("path", params.path);

  const res = await fetch(url.toString(), { method: "POST" });
  if (!res.ok) throw new Error(`FS remove failed: ${res.status}`);

  const json = (await res.json()) as APIResponse<unknown>;
  if (json.code !== 0) throw new Error(json.message || "FS remove failed");
}

export async function fsRename(params: {
  type: FSEndpointType;
  assetId?: string;
  from: string;
  to: string;
}): Promise<void> {
  const url = new URL(getApiUrl("/api/fs/rename"));
  url.searchParams.set("type", params.type);
  if (params.assetId) url.searchParams.set("asset_id", params.assetId);
  url.searchParams.set("from", params.from);
  url.searchParams.set("to", params.to);

  const res = await fetch(url.toString(), { method: "POST" });
  if (!res.ok) throw new Error(`FS rename failed: ${res.status}`);

  const json = (await res.json()) as APIResponse<unknown>;
  if (json.code !== 0) throw new Error(json.message || "FS rename failed");
}

