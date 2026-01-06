import { getApiUrl } from "./base";

export interface APIResponse<T> {
  code?: number;
  message?: string;
  data?: T;
}

export type AssetType = "folder" | "local" | "ssh" | "docker_host";

export interface Asset {
  id: string;
  name: string;
  type: AssetType;
  description?: string;
  config?: Record<string, unknown>;
  tags?: string[];
  parent_id?: string | null;
  prev_id?: string | null;
  next_id?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface AssetListResponse {
  assets: Asset[];
  total: number;
}

export interface ContainerInfo {
  id: string;
  name: string;
  image: string;
  state: string;
  status: string;
  ports: string;
  created: string;
}

export interface CreateAssetRequest {
  name: string;
  type: AssetType;
  description?: string;
  config?: Record<string, unknown>;
  tags?: string[];
  parent_id?: string | null;
}

export interface UpdateAssetRequest {
  name?: string;
  description?: string;
  config?: Record<string, unknown>;
  tags?: string[];
}

export interface MoveAssetRequest {
  new_parent_id: string | null;
  target_sibling_id?: string | null;
  position: "before" | "after" | "append";
}

// ============================================================================
// Asset CRUD APIs
// ============================================================================

/**
 * List all assets
 */
export async function listAssets(): Promise<Asset[]> {
  const resp = await fetch(getApiUrl("/api/assets"));
  if (!resp.ok) {
    throw new Error(`List assets failed: HTTP ${resp.status}`);
  }
  const result = (await resp.json()) as APIResponse<AssetListResponse>;
  const list = result.data?.assets || (result.data as any)?.Assets || [];
  return Array.isArray(list) ? list : [];
}

/**
 * Get a single asset by ID
 */
export async function getAsset(id: string): Promise<Asset> {
  const url = getApiUrl(`/api/assets/${encodeURIComponent(id)}`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Get asset failed: ${res.status}`);

  const json = (await res.json()) as APIResponse<Asset>;

  if (typeof json.code === "number") {
    if (json.code !== 0 && json.code !== 200) throw new Error(json.message || "Get asset failed");
    if (!json.data) throw new Error("Get asset: empty response");
    return json.data;
  }

  return json as unknown as Asset;
}

/**
 * Create a new asset
 */
export async function createAsset(req: CreateAssetRequest): Promise<Asset> {
  const resp = await fetch(getApiUrl("/api/assets"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
  });
  if (!resp.ok) {
    throw new Error(`Create asset failed: HTTP ${resp.status}`);
  }
  const json = (await resp.json()) as APIResponse<Asset>;
  if (json.code !== 200 && json.code !== 0) {
    throw new Error(json.message || "Create asset failed");
  }
  return json.data!;
}

/**
 * Update an existing asset
 */
export async function updateAsset(id: string, req: UpdateAssetRequest): Promise<Asset> {
  const resp = await fetch(getApiUrl(`/api/assets/${encodeURIComponent(id)}`), {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
  });
  if (!resp.ok) {
    throw new Error(`Update asset failed: HTTP ${resp.status}`);
  }
  const json = (await resp.json()) as APIResponse<Asset>;
  if (json.code !== 200 && json.code !== 0) {
    throw new Error(json.message || "Update asset failed");
  }
  return json.data!;
}

/**
 * Delete an asset
 */
export async function deleteAsset(id: string): Promise<void> {
  const resp = await fetch(getApiUrl(`/api/assets/${encodeURIComponent(id)}`), {
    method: "DELETE",
  });
  if (!resp.ok) {
    throw new Error(`Delete asset failed: HTTP ${resp.status}`);
  }
}

/**
 * Move an asset to a new position
 */
export async function moveAsset(id: string, req: MoveAssetRequest): Promise<Asset> {
  const resp = await fetch(getApiUrl(`/api/assets/${encodeURIComponent(id)}/move`), {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
  });
  if (!resp.ok) {
    throw new Error(`Move asset failed: HTTP ${resp.status}`);
  }
  const json = (await resp.json()) as APIResponse<Asset>;
  if (json.code !== 200 && json.code !== 0) {
    throw new Error(json.message || "Move asset failed");
  }
  return json.data!;
}

// ============================================================================
// Docker Container APIs
// ============================================================================

/**
 * List Docker containers for an asset
 */
export async function listDockerContainers(assetId: string, showAll = true): Promise<ContainerInfo[]> {
  const resp = await fetch(getApiUrl(`/api/assets/${encodeURIComponent(assetId)}/docker/containers?all=${showAll}`));
  if (!resp.ok) {
    throw new Error(`List containers failed: HTTP ${resp.status}`);
  }
  const data = (await resp.json()) as APIResponse<{ containers: ContainerInfo[] }>;
  if (data.code === 200 && data.data?.containers) {
    return data.data.containers;
  }
  return [];
}

/**
 * Perform an action on a Docker container (start, stop, restart)
 */
export async function containerAction(
  assetId: string,
  containerId: string,
  action: "start" | "stop" | "restart"
): Promise<void> {
  const resp = await fetch(
    getApiUrl(`/api/assets/${encodeURIComponent(assetId)}/docker/containers/${encodeURIComponent(containerId)}/${action}`),
    { method: "POST" }
  );
  if (!resp.ok) {
    throw new Error(`Container ${action} failed: HTTP ${resp.status}`);
  }
}
