import { getApiUrl } from "../../../api/base";

export type AssetType = "local" | "ssh" | "folder" | "docker_host";

export interface CreateAssetBody<TConfig = Record<string, any>> {
  name: string;
  type: AssetType;
  description?: string;
  config: TConfig;
  tags?: string[];
  parent_id?: string | null;
}

export interface ApiResponse<T = any> {
  code: number;
  message: string;
  data?: T;
}

export interface BasicFolder {
  id: string;
  name: string;
  parent_id: string | null;
}

export interface FolderTreeItem {
  id: string;
  name: string;
  depth: number;
}

export interface SSHKeyInfo {
  path: string;
  encrypted: boolean;
}

export interface AssetLike {
  id?: string;
  name?: string;
  type?: AssetType;
  description?: string;
  config?: Record<string, any>;
  parent_id?: string | null;
}

// Note: do not use getApiUrl("") + "/api/..." concatenation.
// Always build full endpoints via getApiUrl("/api/..."), so URL joining stays correct.

export async function listFolders(): Promise<BasicFolder[]> {
  const resp = await fetch(getApiUrl("/api/assets?type=folder"));
  const json: ApiResponse<{ assets: BasicFolder[] }> = await resp.json();
  if (json.code === 200) return json.data?.assets || [];
  return [];
}

export async function createAsset<TConfig = Record<string, any>>(
  body: CreateAssetBody<TConfig>,
): Promise<ApiResponse> {
  const resp = await fetch(getApiUrl("/api/assets"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await resp
    .json()
    .catch(() => ({ code: resp.status, message: resp.statusText }));
  return json as ApiResponse;
}

export async function updateAsset<TConfig = Record<string, any>>(
  id: string,
  body: Partial<CreateAssetBody<TConfig>> & {
    name?: string;
    description?: string;
    config?: TConfig;
    parent_id?: string | null;
  },
): Promise<ApiResponse> {
  const resp = await fetch(getApiUrl(`/api/assets/${id}`), {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await resp
    .json()
    .catch(() => ({ code: resp.status, message: resp.statusText }));
  return json as ApiResponse;
}

export async function listSSHKeys(): Promise<SSHKeyInfo[]> {
  const resp = await fetch(getApiUrl("/api/assets/user-ssh-keys"));
  const json: ApiResponse<{ keys: SSHKeyInfo[] }> = await resp
    .json()
    .catch(() => ({ code: resp.status, message: resp.statusText }) as any);
  if (json.code === 200) return json.data?.keys || [];
  return [];
}

export async function inspectSSHKey(path: string): Promise<SSHKeyInfo | null> {
  if (!path) return null;
  const url = new URL(getApiUrl("/api/assets/user-ssh-key-inspect"));
  url.searchParams.set("path", path);
  const resp = await fetch(url.toString());
  const json: ApiResponse<SSHKeyInfo> = await resp
    .json()
    .catch(() => ({ code: resp.status, message: resp.statusText }) as any);
  if (json.code === 200 && json.data) return json.data;
  return null;
}

// List all assets
export async function listAssets(type?: AssetType): Promise<AssetLike[]> {
  const url = type
    ? getApiUrl(`/api/assets?type=${type}`)
    : getApiUrl("/api/assets");
  const resp = await fetch(url);
  const json: ApiResponse<{ assets: AssetLike[] }> = await resp
    .json()
    .catch(() => ({ code: resp.status, message: resp.statusText }) as any);
  if (json.code === 200) return json.data?.assets || [];
  return [];
}

// Get a single asset by ID
export async function getAsset(id: string): Promise<AssetLike | null> {
  const resp = await fetch(getApiUrl(`/api/assets/${id}`));
  const json: ApiResponse<AssetLike> = await resp
    .json()
    .catch(() => ({ code: resp.status, message: resp.statusText }) as any);
  if (json.code === 200 && json.data) return json.data;
  return null;
}

// Folder utilities moved here for reuse by dialogs/forms
export function buildFolderTreeItems(folders: BasicFolder[]): FolderTreeItem[] {
  const childrenMap: Record<string, BasicFolder[]> = {};
  folders.forEach((f) => {
    const pid = f.parent_id || "__root__";
    (childrenMap[pid] ||= []).push(f);
  });
  Object.values(childrenMap).forEach((arr) =>
    arr.sort((a, b) => a.name.localeCompare(b.name)),
  );
  const res: FolderTreeItem[] = [];
  const dfs = (parentKey: string, depth: number) => {
    const arr = childrenMap[parentKey];
    if (!arr) return;
    arr.forEach((f) => {
      res.push({ id: f.id, name: f.name, depth });
      dfs(f.id, depth + 1);
    });
  };
  dfs("__root__", 1);
  return res;
}
