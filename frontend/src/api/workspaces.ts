// Workspace API client

import { getApiBase } from "./base";

const baseUrl = getApiBase();

// Types matching backend models
export interface WorkspaceRuntime {
  type: "local" | "docker-local" | "docker-remote";
  docker_asset_id?: string;
  container_mode?: "existing" | "new";
  container_id?: string;
  container_name?: string;
  new_container_image?: string;
  new_container_name?: string;
  work_dir_path: string;
  work_dir_container_path?: string;
}

export interface WorkspaceAssetRef {
  id: string;
  asset_id: string;
  asset_type: string;
  asset_name: string;
  ai_hint?: string;
  restrictions?: Record<string, unknown>;
  created_at: string;
}

export interface WorkspaceTool {
  id: string;
  name: string;
  type: string;
  description?: string;
  enabled: boolean;
  config: Record<string, unknown>;
  ai_hint?: string;
  created_at: string;
  updated_at: string;
}

export interface Room {
  id: string;
  workspace_id: string;
  name: string;
  description?: string;
  layout?: Record<string, unknown>;
  active_pane_id?: string;
  current_conversation_id?: string;
  created_at: string;
  updated_at: string;
}

export interface Workspace {
  id: string;
  name: string;
  description?: string;
  status: "running" | "stopped" | "starting" | "stopping" | "error";
  color: string;
  active_room_id: string;
  // Memory configuration
  memory_enabled?: boolean;
  embedding_provider?: string;
  embedding_model?: string;
  // Relations
  runtime?: WorkspaceRuntime;
  assets?: WorkspaceAssetRef[];
  tools?: WorkspaceTool[];
  rooms?: Room[];
  created_at: string;
  updated_at: string;
}

export interface WorkspaceListItem {
  id: string;
  name: string;
  description: string;
  status: string;
  color: string;
  runtime_type: string;
  rooms_count: number;
  created_at: string;
  updated_at: string;
}

export interface CreateWorkspaceRequest {
  name: string;
  description?: string;
  color?: string;
  // Memory configuration
  memory_enabled?: boolean;
  embedding_provider?: string;
  embedding_model?: string;
  // Runtime and relations
  runtime?: {
    type: "local" | "docker-local" | "docker-remote";
    docker_asset_id?: string;
    container_mode?: "existing" | "new";
    container_id?: string;
    new_container_image?: string;
    new_container_name?: string;
    work_dir_path: string;
    work_dir_container_path?: string;
  };
  assets?: {
    asset_id: string;
    ai_hint?: string;
    restrictions?: Record<string, unknown>;
  }[];
  tools?: {
    name: string;
    type: string;
    description?: string;
    enabled?: boolean;
    config: Record<string, unknown>;
    ai_hint?: string;
  }[];
  agents?: {
    name: string;
    type: string;
    description?: string;
    enabled?: boolean;
    model_id?: string;
    instruction?: string;
    tool_ids?: string[];
    sub_agent_ids?: string[];
    type_config?: Record<string, unknown>;
    max_iterations?: number;
    ai_hint?: string;
  }[];
}

export interface UpdateWorkspaceRequest {
  name?: string;
  description?: string;
  color?: string;
  // Memory configuration
  memory_enabled?: boolean;
  embedding_provider?: string;
  embedding_model?: string;
  // Relations
  runtime?: CreateWorkspaceRequest["runtime"];
  assets?: CreateWorkspaceRequest["assets"];
  tools?: CreateWorkspaceRequest["tools"];
  agents?: CreateWorkspaceRequest["agents"];
}

export interface WorkspaceStatus {
  status: string;
  runtime?: {
    type: string;
    container_status?: string;
    container_id?: string;
    uptime?: number;
  };
  tools?: {
    id: string;
    name: string;
    status: string;
    error?: string;
  }[];
}

// API functions

export async function listWorkspaces(status?: string): Promise<WorkspaceListItem[]> {
  const url = new URL(`${baseUrl}/api/workspaces`);
  if (status) {
    url.searchParams.set("status", status);
  }
  const res = await fetch(url.toString());
  if (!res.ok) {
    throw new Error(`Failed to list workspaces: ${res.statusText}`);
  }
  const data = await res.json();
  return data.workspaces || [];
}

export async function getWorkspace(id: string): Promise<Workspace> {
  const res = await fetch(`${baseUrl}/api/workspaces/${id}`);
  if (!res.ok) {
    throw new Error(`Failed to get workspace: ${res.statusText}`);
  }
  return res.json();
}

export async function createWorkspace(req: CreateWorkspaceRequest): Promise<Workspace> {
  const res = await fetch(`${baseUrl}/api/workspaces`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Failed to create workspace: ${res.statusText}`);
  }
  return res.json();
}

export async function updateWorkspace(id: string, req: UpdateWorkspaceRequest): Promise<Workspace> {
  const res = await fetch(`${baseUrl}/api/workspaces/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Failed to update workspace: ${res.statusText}`);
  }
  return res.json();
}

export async function deleteWorkspace(id: string, force = false): Promise<void> {
  const url = new URL(`${baseUrl}/api/workspaces/${id}`);
  if (force) {
    url.searchParams.set("force", "true");
  }
  const res = await fetch(url.toString(), { method: "DELETE" });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Failed to delete workspace: ${res.statusText}`);
  }
}

export async function cloneWorkspace(id: string, newName: string): Promise<Workspace> {
  const res = await fetch(`${baseUrl}/api/workspaces/${id}/clone`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: newName }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Failed to clone workspace: ${res.statusText}`);
  }
  return res.json();
}

export async function startWorkspace(id: string): Promise<void> {
  const res = await fetch(`${baseUrl}/api/workspaces/${id}/start`, { method: "POST" });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Failed to start workspace: ${res.statusText}`);
  }
}

export async function stopWorkspace(id: string, force = false): Promise<void> {
  const url = new URL(`${baseUrl}/api/workspaces/${id}/stop`);
  if (force) {
    url.searchParams.set("force", "true");
  }
  const res = await fetch(url.toString(), { method: "POST" });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Failed to stop workspace: ${res.statusText}`);
  }
}

export async function getWorkspaceStatus(id: string): Promise<WorkspaceStatus> {
  const res = await fetch(`${baseUrl}/api/workspaces/${id}/status`);
  if (!res.ok) {
    throw new Error(`Failed to get workspace status: ${res.statusText}`);
  }
  return res.json();
}

// Room API

export async function listRooms(workspaceId: string): Promise<{ rooms: Room[]; active_room_id: string }> {
  const res = await fetch(`${baseUrl}/api/workspaces/${workspaceId}/rooms`);
  if (!res.ok) {
    throw new Error(`Failed to list rooms: ${res.statusText}`);
  }
  return res.json();
}

export async function createRoom(workspaceId: string, name: string, description?: string): Promise<Room> {
  const res = await fetch(`${baseUrl}/api/workspaces/${workspaceId}/rooms`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, description }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Failed to create room: ${res.statusText}`);
  }
  return res.json();
}

export async function updateRoom(
  workspaceId: string,
  roomId: string,
  data: { name?: string; description?: string; layout?: Record<string, unknown>; current_conversation_id?: string }
): Promise<Room> {
  const res = await fetch(`${baseUrl}/api/workspaces/${workspaceId}/rooms/${roomId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Failed to update room: ${res.statusText}`);
  }
  return res.json();
}

export async function deleteRoom(workspaceId: string, roomId: string): Promise<void> {
  const res = await fetch(`${baseUrl}/api/workspaces/${workspaceId}/rooms/${roomId}`, {
    method: "DELETE",
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Failed to delete room: ${res.statusText}`);
  }
}

export async function cloneRoom(workspaceId: string, roomId: string, newName: string): Promise<Room> {
  const res = await fetch(`${baseUrl}/api/workspaces/${workspaceId}/rooms/${roomId}/clone`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: newName }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Failed to clone room: ${res.statusText}`);
  }
  return res.json();
}

export async function activateRoom(workspaceId: string, roomId: string): Promise<void> {
  const res = await fetch(`${baseUrl}/api/workspaces/${workspaceId}/rooms/${roomId}/activate`, {
    method: "POST",
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Failed to activate room: ${res.statusText}`);
  }
}

// Asset API

export async function listWorkspaceAssets(workspaceId: string): Promise<WorkspaceAssetRef[]> {
  const res = await fetch(`${baseUrl}/api/workspaces/${workspaceId}/assets`);
  if (!res.ok) {
    throw new Error(`Failed to list assets: ${res.statusText}`);
  }
  const data = await res.json();
  return data.assets || [];
}

export async function addWorkspaceAsset(
  workspaceId: string,
  assetId: string,
  aiHint?: string,
  restrictions?: Record<string, unknown>
): Promise<WorkspaceAssetRef> {
  const res = await fetch(`${baseUrl}/api/workspaces/${workspaceId}/assets`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ asset_id: assetId, ai_hint: aiHint, restrictions }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Failed to add asset: ${res.statusText}`);
  }
  return res.json();
}

export async function updateWorkspaceAsset(
  workspaceId: string,
  refId: string,
  data: { ai_hint?: string; restrictions?: Record<string, unknown> }
): Promise<WorkspaceAssetRef> {
  const res = await fetch(`${baseUrl}/api/workspaces/${workspaceId}/assets/${refId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Failed to update asset: ${res.statusText}`);
  }
  return res.json();
}

export async function removeWorkspaceAsset(workspaceId: string, refId: string): Promise<void> {
  const res = await fetch(`${baseUrl}/api/workspaces/${workspaceId}/assets/${refId}`, {
    method: "DELETE",
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Failed to remove asset: ${res.statusText}`);
  }
}

// Tool API

export async function listWorkspaceTools(workspaceId: string): Promise<WorkspaceTool[]> {
  const res = await fetch(`${baseUrl}/api/workspaces/${workspaceId}/tools`);
  if (!res.ok) {
    throw new Error(`Failed to list tools: ${res.statusText}`);
  }
  const data = await res.json();
  return data.tools || [];
}

export async function addWorkspaceTool(
  workspaceId: string,
  tool: {
    name: string;
    type: string;
    description?: string;
    enabled?: boolean;
    config: Record<string, unknown>;
    ai_hint?: string;
  }
): Promise<WorkspaceTool> {
  const res = await fetch(`${baseUrl}/api/workspaces/${workspaceId}/tools`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(tool),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Failed to add tool: ${res.statusText}`);
  }
  return res.json();
}

export async function updateWorkspaceTool(
  workspaceId: string,
  toolId: string,
  data: {
    name?: string;
    description?: string;
    enabled?: boolean;
    config?: Record<string, unknown>;
    ai_hint?: string;
  }
): Promise<WorkspaceTool> {
  const res = await fetch(`${baseUrl}/api/workspaces/${workspaceId}/tools/${toolId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Failed to update tool: ${res.statusText}`);
  }
  return res.json();
}

export async function removeWorkspaceTool(workspaceId: string, toolId: string): Promise<void> {
  const res = await fetch(`${baseUrl}/api/workspaces/${workspaceId}/tools/${toolId}`, {
    method: "DELETE",
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Failed to remove tool: ${res.statusText}`);
  }
}

export async function toggleWorkspaceTool(workspaceId: string, toolId: string, enabled: boolean): Promise<WorkspaceTool> {
  const res = await fetch(`${baseUrl}/api/workspaces/${workspaceId}/tools/${toolId}/toggle`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ enabled }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Failed to toggle tool: ${res.statusText}`);
  }
  return res.json();
}

export async function testWorkspaceTool(workspaceId: string, toolId: string): Promise<{
  success: boolean;
  message?: string;
  capabilities?: string[];
  tools_count?: number;
}> {
  const res = await fetch(`${baseUrl}/api/workspaces/${workspaceId}/tools/${toolId}/test`, {
    method: "POST",
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Failed to test tool: ${res.statusText}`);
  }
  return res.json();
}

// =====================================
// Agent Types (Single Agent Configuration)
// =====================================

// Agent types supported by ADK
export type AgentType =
  | "chat_model"
  | "supervisor"
  | "deep"
  | "plan_execute"
  | "sequential"
  | "loop"
  | "parallel";

// Agent type display info
export const AGENT_TYPE_INFO: Record<AgentType, { label: string; description: string }> = {
  chat_model: {
    label: "Chat Model",
    description: "Basic agent with a chat model"
  },
  supervisor: {
    label: "Supervisor",
    description: "Coordinates sub-agents to accomplish tasks"
  },
  deep: {
    label: "Deep Agent",
    description: "Advanced reasoning with planning capabilities"
  },
  plan_execute: {
    label: "Plan & Execute",
    description: "Plans then executes with separate agents"
  },
  sequential: {
    label: "Sequential Workflow",
    description: "Executes sub-agents in sequence"
  },
  loop: {
    label: "Loop Workflow",
    description: "Repeats sub-agents until exit condition"
  },
  parallel: {
    label: "Parallel Workflow",
    description: "Executes sub-agents in parallel"
  }
};

// Type-specific configurations
export interface DeepAgentTypeConfig {
  withoutWriteTodos?: boolean;
  withoutGeneralSubAgent?: boolean;
}

export interface PlanExecuteSubAgentConfig {
  modelName?: string;
  modelProvider?: string;
  instruction?: string;
  toolIds?: string[];
}

export interface PlanExecuteAgentTypeConfig {
  planner?: PlanExecuteSubAgentConfig;
  executor?: PlanExecuteSubAgentConfig;
  replanner?: PlanExecuteSubAgentConfig;
}

export interface LoopAgentTypeConfig {
  maxIterations?: number;
  breakCondition?: string;
}

export interface ParallelAgentTypeConfig {
  mergeStrategy?: "first" | "all" | "any";
}

// Union type for all agent type configs
export type AgentTypeConfig =
  | ({ type: "chat_model" })
  | ({ type: "supervisor" })
  | ({ type: "deep" } & DeepAgentTypeConfig)
  | ({ type: "plan_execute" } & PlanExecuteAgentTypeConfig)
  | ({ type: "sequential" })
  | ({ type: "loop" } & LoopAgentTypeConfig)
  | ({ type: "parallel" } & ParallelAgentTypeConfig);

// Agent - single agent configuration
export interface Agent {
  id: string;
  name: string;
  type: AgentType;
  description?: string;
  enabled?: boolean;
  modelName?: string;
  modelProvider?: string;
  instruction?: string;
  toolIds?: string[];
  subAgentIds?: string[];
  typeConfig?: AgentTypeConfig;
  maxIterations?: number;
  aiHint?: string;
}

// =====================================
// WorkspaceAgent API (Canvas Composition)
// =====================================

// Position for nodes on canvas
export interface WorkspaceAgentNodePosition {
  x: number;
  y: number;
}

// Node in the workspace agent canvas
export interface WorkspaceAgentNode {
  id: string;
  type: "agent" | "start";
  agent_id?: string;  // Reference to Agent.id
  agent?: Agent;      // Optional: embedded agent config (for convenience)
  position: WorkspaceAgentNodePosition;
}

// Edge connecting nodes
export interface WorkspaceAgentEdge {
  id: string;
  source: string;
  target: string;
  source_handle?: string;
  target_handle?: string;
  label?: string;
  order: number;
}

// Viewport state
export interface WorkspaceAgentViewport {
  x: number;
  y: number;
  zoom: number;
}

// WorkspaceAgent - canvas layout for composing agents
export interface WorkspaceAgent {
  id: string;
  workspace_id: string;
  name: string;
  description?: string;
  enabled: boolean;
  nodes: WorkspaceAgentNode[];
  edges: WorkspaceAgentEdge[];
  viewport?: WorkspaceAgentViewport;
  entry_node_id?: string;
  created_at: string;
  updated_at: string;
}

export interface CreateWorkspaceAgentRequest {
  name: string;
  description?: string;
  nodes?: WorkspaceAgentNode[];
  edges?: WorkspaceAgentEdge[];
  viewport?: WorkspaceAgentViewport;
  entry_node_id?: string;
  enabled?: boolean;
}

export interface UpdateWorkspaceAgentRequest {
  name?: string;
  description?: string;
  nodes?: WorkspaceAgentNode[];
  edges?: WorkspaceAgentEdge[];
  viewport?: WorkspaceAgentViewport;
  entry_node_id?: string;
  enabled?: boolean;
}

// List all workspace agents
export async function listWorkspaceAgents(workspaceId: string): Promise<WorkspaceAgent[]> {
  const res = await fetch(`${baseUrl}/api/workspaces/${workspaceId}/agents`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Failed to list workspace agents: ${res.statusText}`);
  }
  const data = await res.json();
  return data.data || [];
}

// Get a single workspace agent
export async function getWorkspaceAgent(workspaceId: string, agentId: string): Promise<WorkspaceAgent> {
  const res = await fetch(`${baseUrl}/api/workspaces/${workspaceId}/agents/${agentId}`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Failed to get workspace agent: ${res.statusText}`);
  }
  const data = await res.json();
  return data.data;
}

// Create a new workspace agent
export async function createWorkspaceAgent(
  workspaceId: string,
  agent: CreateWorkspaceAgentRequest
): Promise<WorkspaceAgent> {
  const res = await fetch(`${baseUrl}/api/workspaces/${workspaceId}/agents`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(agent),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Failed to create workspace agent: ${res.statusText}`);
  }
  const data = await res.json();
  return data.data;
}

// Update a workspace agent
export async function updateWorkspaceAgent(
  workspaceId: string,
  agentId: string,
  updates: UpdateWorkspaceAgentRequest
): Promise<WorkspaceAgent> {
  const res = await fetch(`${baseUrl}/api/workspaces/${workspaceId}/agents/${agentId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(updates),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Failed to update workspace agent: ${res.statusText}`);
  }
  const data = await res.json();
  return data.data;
}

// Delete a workspace agent
export async function deleteWorkspaceAgent(workspaceId: string, agentId: string): Promise<void> {
  const res = await fetch(`${baseUrl}/api/workspaces/${workspaceId}/agents/${agentId}`, {
    method: "DELETE",
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Failed to delete workspace agent: ${res.statusText}`);
  }
}

// Toggle workspace agent enabled state
export async function toggleWorkspaceAgent(
  workspaceId: string,
  agentId: string,
  enabled: boolean
): Promise<WorkspaceAgent> {
  const res = await fetch(`${baseUrl}/api/workspaces/${workspaceId}/agents/${agentId}/toggle`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ enabled }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Failed to toggle workspace agent: ${res.statusText}`);
  }
  const data = await res.json();
  return data.data;
}

