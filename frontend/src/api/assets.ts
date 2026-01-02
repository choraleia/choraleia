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
}

export async function getAsset(id: string): Promise<Asset> {
  const url = getApiUrl(`/api/assets/${encodeURIComponent(id)}`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Get asset failed: ${res.status}`);

  const json = (await res.json()) as APIResponse<Asset>;

  // Asset endpoints in this repo often respond with {code,message,data}
  if (typeof json.code === "number") {
    if (json.code !== 0) throw new Error(json.message || "Get asset failed");
    if (!json.data) throw new Error("Get asset: empty response");
    return json.data;
  }

  // Fallback: some endpoints may return the asset directly
  return json as unknown as Asset;
}

