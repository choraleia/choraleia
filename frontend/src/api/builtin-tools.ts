// Built-in Tools API - Fetch available built-in tools from backend

import { getApiBase } from "./base";

const baseUrl = getApiBase();

// Built-in tool definition from backend
export interface BuiltinToolDefinition {
  id: string;
  name: string;
  description: string;
  category: "workspace" | "asset" | "database" | "transfer";
  scope: "workspace" | "global" | "both";
  dangerous: boolean;
}

export interface ListBuiltinToolsResponse {
  tools: BuiltinToolDefinition[];
  categories: string[];
}

// List all available built-in tools
export async function listBuiltinTools(options?: {
  category?: string;
  scope?: string;
  safeOnly?: boolean;
}): Promise<ListBuiltinToolsResponse> {
  const params = new URLSearchParams();
  if (options?.category) params.set("category", options.category);
  if (options?.scope) params.set("scope", options.scope);
  if (options?.safeOnly) params.set("safe_only", "true");

  const url = `${baseUrl}/api/builtin-tools${params.toString() ? `?${params}` : ""}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to list builtin tools: ${res.statusText}`);
  }
  return res.json();
}

