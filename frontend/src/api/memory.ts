// Memory API client
import { getApiBase } from "./base";

const baseUrl = getApiBase();

// ========== Types ==========

export type MemoryScope = "workspace" | "agent" | "conversation";
export type MemoryVisibility = "public" | "private" | "inherit";
export type MemoryType = "fact" | "preference" | "instruction" | "learned" | "summary" | "detail";
export type MemorySourceType = "conversation" | "compression" | "tool" | "user" | "system";

export interface Memory {
  id: string;
  workspace_id: string;
  scope: MemoryScope;
  agent_id?: string;
  visibility: MemoryVisibility;
  type: MemoryType;
  category: string;
  key: string;
  content: string;
  metadata?: Record<string, unknown>;
  source_type?: MemorySourceType;
  source_id?: string;
  tags?: string[];
  importance: number;
  access_count: number;
  last_access?: string;
  expires_at?: string;
  created_at: string;
  updated_at: string;
}

export interface MemoryWithCompression extends Memory {
  compression_info?: {
    is_compressed: boolean;
    snapshot_id?: string;
  };
}

export interface CreateMemoryRequest {
  type: MemoryType;
  key: string;
  content: string;
  scope?: MemoryScope;
  agent_id?: string;
  visibility?: MemoryVisibility;
  category?: string;
  tags?: string[];
  importance?: number;
  source_type?: MemorySourceType;
  source_id?: string;
  expires_at?: string;
}

export interface UpdateMemoryRequest {
  content?: string;
  category?: string;
  tags?: string[];
  importance?: number;
  expires_at?: string | null;
}

export interface MemoryQueryOptions {
  type?: MemoryType;
  category?: string;
  scope?: MemoryScope;
  keyword?: string;
  agent_id?: string;
  limit?: number;
}

export interface MemorySearchResult {
  id: string;
  workspace_id: string;
  type: MemoryType;
  key: string;
  content: string;
  category: string;
  importance: number;
  similarity: number;
  created_at: string;
}

export interface MemorySearchRequest {
  query: string;
  agent_id?: string;
  types?: MemoryType[];
  limit?: number;
}

export interface MemorySourceInfo {
  source_type: string;
  source_id?: string;
  conversation_id?: string;
  conversation_name?: string;
  snapshot_id?: string;
  created_at?: string;
}

// ========== Statistics & Lifecycle ==========

export interface MemoryStats {
  workspace_id: string;
  total_count: number;
  by_type: Record<string, number>;
  by_scope: Record<string, number>;
  by_category: Record<string, number>;
  by_source_type: Record<string, number>;
  avg_importance: number;
  total_access_count: number;
  recently_created: number;
  recently_accessed: number;
}

export interface MemoryExportData {
  version: string;
  exported_at: string;
  workspace_id: string;
  memories: Memory[];
  stats?: MemoryStats;
}

export interface ImportMemoriesOptions {
  overwrite_existing?: boolean;
  skip_duplicates?: boolean;
  reset_access_stats?: boolean;
}

export interface ImportMemoriesResult {
  total_processed: number;
  imported: number;
  updated: number;
  skipped: number;
  errors?: string[];
}

// ========== Optimization ==========

export interface DuplicateGroup {
  base_memory: Memory;
  duplicates: Memory[];
  similarity: number;
  suggested_key: string;
}

export interface MergeMemoriesRequest {
  memory_ids: string[];
  new_key: string;
  new_content?: string;
  keep_originals?: boolean;
}

export interface MergeResult {
  merged_memory: Memory;
  deleted_count: number;
  archived_count: number;
}

export interface AutoMergeResult {
  groups_found: number;
  groups_merged: number;
  memories_merged: number;
}

export interface PriorityAdjustmentResult {
  total_processed: number;
  adjusted: number;
  boosted: number;
}

export interface MemoryNode {
  id: string;
  label: string;
  type: string;
  category: string;
  importance: number;
  size: number;
  group: string;
}

export interface MemoryEdge {
  source: string;
  target: string;
  weight: number;
  relation: string;
}

export interface MemoryGraph {
  nodes: MemoryNode[];
  edges: MemoryEdge[];
}

export interface MemoryGraphOptions {
  max_nodes?: number;
  include_similarities?: boolean;
  similarity_threshold?: number;
  filter_type?: string;
  filter_category?: string;
}

export interface RecommendedAction {
  action: string;
  description: string;
  impact: "high" | "medium" | "low";
  memory_count: number;
}

export interface MemoryInsights {
  total_memories: number;
  duplicate_groups: number;
  potential_merges: number;
  low_quality_count: number;
  high_value_count: number;
  category_distribution: Record<string, number>;
  type_distribution: Record<string, number>;
  recommended_actions: RecommendedAction[];
}

// ========== API Functions ==========

// --- CRUD ---

export async function listMemories(
  workspaceId: string,
  options?: MemoryQueryOptions
): Promise<{ memories: Memory[]; count: number }> {
  const params = new URLSearchParams();
  if (options?.type) params.set("type", options.type);
  if (options?.category) params.set("category", options.category);
  if (options?.scope) params.set("scope", options.scope);
  if (options?.keyword) params.set("keyword", options.keyword);
  if (options?.agent_id) params.set("agent_id", options.agent_id);
  if (options?.limit) params.set("limit", options.limit.toString());

  const url = `${baseUrl}/api/workspaces/${workspaceId}/memories?${params}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function createMemory(
  workspaceId: string,
  request: CreateMemoryRequest
): Promise<Memory> {
  const res = await fetch(`${baseUrl}/api/workspaces/${workspaceId}/memories`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function getMemory(
  workspaceId: string,
  memoryId: string
): Promise<Memory> {
  const res = await fetch(
    `${baseUrl}/api/workspaces/${workspaceId}/memories/${memoryId}`
  );
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function getMemorySource(
  workspaceId: string,
  memoryId: string
): Promise<MemorySourceInfo> {
  const res = await fetch(
    `${baseUrl}/api/workspaces/${workspaceId}/memories/${memoryId}/source`
  );
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function updateMemory(
  workspaceId: string,
  memoryId: string,
  request: UpdateMemoryRequest
): Promise<Memory> {
  const res = await fetch(
    `${baseUrl}/api/workspaces/${workspaceId}/memories/${memoryId}`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    }
  );
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function deleteMemory(
  workspaceId: string,
  memoryId: string
): Promise<void> {
  const res = await fetch(
    `${baseUrl}/api/workspaces/${workspaceId}/memories/${memoryId}`,
    { method: "DELETE" }
  );
  if (!res.ok) throw new Error(await res.text());
}

export async function searchMemories(
  workspaceId: string,
  request: MemorySearchRequest
): Promise<{ results: MemorySearchResult[]; count: number }> {
  const res = await fetch(
    `${baseUrl}/api/workspaces/${workspaceId}/memories/search`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    }
  );
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

// --- Statistics & Lifecycle ---

export async function getMemoryStats(workspaceId: string): Promise<MemoryStats> {
  const res = await fetch(
    `${baseUrl}/api/workspaces/${workspaceId}/memories/stats`
  );
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function exportMemories(
  workspaceId: string,
  includeStats = false
): Promise<MemoryExportData> {
  const params = new URLSearchParams();
  if (includeStats) params.set("include_stats", "true");

  const res = await fetch(
    `${baseUrl}/api/workspaces/${workspaceId}/memories/export?${params}`
  );
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function downloadMemoriesFile(
  workspaceId: string,
  includeStats = false
): Promise<Blob> {
  const params = new URLSearchParams({ format: "file" });
  if (includeStats) params.set("include_stats", "true");

  const res = await fetch(
    `${baseUrl}/api/workspaces/${workspaceId}/memories/export?${params}`
  );
  if (!res.ok) throw new Error(await res.text());
  return res.blob();
}

export async function importMemories(
  workspaceId: string,
  data: MemoryExportData,
  options?: ImportMemoriesOptions
): Promise<ImportMemoriesResult> {
  const res = await fetch(
    `${baseUrl}/api/workspaces/${workspaceId}/memories/import`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        data,
        ...options,
      }),
    }
  );
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function importMemoriesFile(
  workspaceId: string,
  file: File,
  options?: ImportMemoriesOptions
): Promise<ImportMemoriesResult> {
  const formData = new FormData();
  formData.append("file", file);
  if (options?.skip_duplicates !== undefined) {
    formData.append("skip_duplicates", options.skip_duplicates.toString());
  }
  if (options?.overwrite_existing !== undefined) {
    formData.append("overwrite_existing", options.overwrite_existing.toString());
  }
  if (options?.reset_access_stats !== undefined) {
    formData.append("reset_access_stats", options.reset_access_stats.toString());
  }

  const res = await fetch(
    `${baseUrl}/api/workspaces/${workspaceId}/memories/import`,
    {
      method: "POST",
      body: formData,
    }
  );
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function runMemoryCleanup(workspaceId: string): Promise<void> {
  const res = await fetch(
    `${baseUrl}/api/workspaces/${workspaceId}/memories/cleanup`,
    { method: "POST" }
  );
  if (!res.ok) throw new Error(await res.text());
}

// --- Optimization ---

export async function findDuplicates(
  workspaceId: string
): Promise<{ groups: DuplicateGroup[]; count: number }> {
  const res = await fetch(
    `${baseUrl}/api/workspaces/${workspaceId}/memories/duplicates`
  );
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function mergeMemories(
  workspaceId: string,
  request: MergeMemoriesRequest
): Promise<MergeResult> {
  const res = await fetch(
    `${baseUrl}/api/workspaces/${workspaceId}/memories/merge`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    }
  );
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function autoMergeMemories(
  workspaceId: string
): Promise<AutoMergeResult> {
  const res = await fetch(
    `${baseUrl}/api/workspaces/${workspaceId}/memories/auto-merge`,
    { method: "POST" }
  );
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function adjustMemoryPriorities(
  workspaceId: string
): Promise<PriorityAdjustmentResult> {
  const res = await fetch(
    `${baseUrl}/api/workspaces/${workspaceId}/memories/adjust-priorities`,
    { method: "POST" }
  );
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function getMemoryGraph(
  workspaceId: string,
  options?: MemoryGraphOptions
): Promise<MemoryGraph> {
  const params = new URLSearchParams();
  if (options?.max_nodes) params.set("max_nodes", options.max_nodes.toString());
  if (options?.include_similarities !== undefined) {
    params.set("include_similarities", options.include_similarities.toString());
  }
  if (options?.similarity_threshold) {
    params.set("similarity_threshold", options.similarity_threshold.toString());
  }
  if (options?.filter_type) params.set("type", options.filter_type);
  if (options?.filter_category) params.set("category", options.filter_category);

  const res = await fetch(
    `${baseUrl}/api/workspaces/${workspaceId}/memories/graph?${params}`
  );
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function getMemoryInsights(
  workspaceId: string
): Promise<MemoryInsights> {
  const res = await fetch(
    `${baseUrl}/api/workspaces/${workspaceId}/memories/insights`
  );
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

