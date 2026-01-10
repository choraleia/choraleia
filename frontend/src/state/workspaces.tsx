import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { v4 as uuid } from "uuid";
import * as workspacesApi from "../api/workspaces";
import { fsList, FSEntry, fsMkdir, fsTouch, fsRemove, fsRename, fsWrite, fsRead } from "../api/fs";

export type FileNode = {
  id: string;
  name: string;
  path: string;
  type: "file" | "folder";
  children?: FileNode[];
  content?: string;
};

export type ChatMessage = {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: number;
};

// Runtime environment type
export type RuntimeType = "local" | "docker-local" | "docker-remote";

// Work directory configuration (single root per workspace)
export type WorkDirectoryConfig = {
  // For local: host path
  // For docker-local: host path to mount, or empty to use container path only
  // For docker-remote: path inside container
  path: string;
  // Mount path inside container (for docker-local with mount)
  containerPath?: string;
};

// Container selection mode
export type ContainerMode = "existing" | "new";

// New container configuration
export type NewContainerConfig = {
  // Image name (can be preset or custom)
  image: string;
  // Container name (optional, will be auto-generated if empty)
  name?: string;
};

// Preset Docker images for quick selection
export const PRESET_DOCKER_IMAGES = [
  { value: "ubuntu:22.04", label: "Ubuntu 22.04", description: "Official Ubuntu LTS" },
  { value: "ubuntu:24.04", label: "Ubuntu 24.04", description: "Latest Ubuntu LTS" },
  { value: "debian:12", label: "Debian 12 (Bookworm)", description: "Stable Debian" },
  { value: "alpine:3.19", label: "Alpine 3.19", description: "Lightweight Alpine Linux" },
  { value: "node:20", label: "Node.js 20 LTS", description: "Node.js with npm" },
  { value: "node:22", label: "Node.js 22", description: "Latest Node.js" },
  { value: "python:3.12", label: "Python 3.12", description: "Python with pip" },
  { value: "python:3.11", label: "Python 3.11", description: "Python 3.11 LTS" },
  { value: "golang:1.22", label: "Go 1.22", description: "Official Go image" },
  { value: "rust:1.75", label: "Rust 1.75", description: "Rust with cargo" },
  { value: "openjdk:21", label: "OpenJDK 21", description: "Java 21 LTS" },
  { value: "mcr.microsoft.com/devcontainers/base:ubuntu", label: "Dev Container (Ubuntu)", description: "VS Code dev container base" },
  { value: "mcr.microsoft.com/devcontainers/typescript-node:20", label: "Dev Container (Node/TS)", description: "TypeScript & Node.js dev container" },
  { value: "mcr.microsoft.com/devcontainers/python:3.12", label: "Dev Container (Python)", description: "Python dev container" },
  { value: "mcr.microsoft.com/devcontainers/go:1.22", label: "Dev Container (Go)", description: "Go dev container" },
] as const;

// Workspace runtime configuration
export type WorkspaceRuntime = {
  type: RuntimeType;
  // Docker asset ID (required for docker-local and docker-remote)
  dockerAssetId?: string;
  // Container mode: use existing or create new
  containerMode?: ContainerMode;
  // Container ID (for existing container or after new container is created)
  containerId?: string;
  // Container name (for existing container or after new container is created)
  containerName?: string;
  // New container configuration (when containerMode is "new")
  newContainer?: NewContainerConfig;
  // Work directory
  workDir: WorkDirectoryConfig;
};

export type HostAssetConfig = {
  id: string;
  name: string;
  address: string;
  allowedServices: string[];
};

export type K8sAssetConfig = {
  id: string;
  name: string;
  namespace: string;
  allowedServices: string[];
};

// Workspace asset reference - links to a real asset with workspace-specific config
export type WorkspaceAssetRef = {
  id: string;                    // Unique ID for this reference
  assetId: string;               // Reference to the real asset ID
  assetType: string;             // Asset type (ssh, docker_host, local, etc.)
  assetName: string;             // Cached asset name for display
  // AI configuration
  aiHint?: string;               // Hint for AI: what is this, how to use it, what not to do
  // Type-specific restrictions (enforced by program at execution time)
  restrictions?: AssetRestrictions;
};

// Base restrictions common to terminal-based assets
export type TerminalRestrictions = {
  // Command restrictions
  allowedCommands?: string[];    // Whitelist of allowed commands (empty = all allowed)
  blockedCommands?: string[];    // Blacklist of blocked commands
  // File system restrictions
  allowedPaths?: string[];       // Allowed file paths (empty = all allowed)
  blockedPaths?: string[];       // Blocked file paths
  // Environment restrictions
  allowedEnvVars?: string[];     // Allowed environment variables to access
  blockedEnvVars?: string[];     // Blocked environment variables
};

// SSH-specific restrictions
export type SSHRestrictions = TerminalRestrictions & {
  // Port forwarding restrictions
  allowPortForwarding?: boolean;
  allowedForwardPorts?: number[];
  // Session restrictions
  maxSessionDuration?: number;   // Max session duration in seconds
  allowSudo?: boolean;           // Allow sudo commands
  allowScp?: boolean;            // Allow SCP file transfers
  allowSftp?: boolean;           // Allow SFTP operations
};

// Local terminal restrictions
export type LocalRestrictions = TerminalRestrictions & {
  allowSudo?: boolean;           // Allow sudo commands
  allowNetworkAccess?: boolean;  // Allow network-related commands
};

// Docker host restrictions
export type DockerRestrictions = TerminalRestrictions & {
  // Container restrictions
  allowedContainers?: string[];  // Allowed container names/IDs (empty = all)
  blockedContainers?: string[];  // Blocked container names/IDs
  // Operation restrictions
  allowContainerCreate?: boolean;
  allowContainerDelete?: boolean;
  allowContainerExec?: boolean;
  allowImagePull?: boolean;
  allowImageDelete?: boolean;
  allowVolumeAccess?: boolean;
  allowNetworkAccess?: boolean;
  // Resource restrictions
  allowPrivileged?: boolean;     // Allow privileged containers
};

// Database restrictions (for future MySQL, PostgreSQL, etc.)
export type DatabaseRestrictions = {
  readOnly?: boolean;            // Read-only mode
  allowedDatabases?: string[];   // Allowed database names
  blockedDatabases?: string[];   // Blocked database names
  allowedTables?: string[];      // Allowed tables (format: db.table or table)
  blockedTables?: string[];      // Blocked tables
  allowedOperations?: string[];  // Allowed SQL operations (SELECT, INSERT, UPDATE, DELETE, etc.)
  blockedOperations?: string[];  // Blocked SQL operations
  maxRowsReturn?: number;        // Max rows to return in queries
  allowDDL?: boolean;            // Allow DDL operations (CREATE, ALTER, DROP)
  allowStoredProcedures?: boolean;
};

// Kubernetes restrictions (for future K8s assets)
export type K8sRestrictions = {
  allowedNamespaces?: string[];  // Allowed namespaces (empty = all)
  blockedNamespaces?: string[];  // Blocked namespaces
  allowedResources?: string[];   // Allowed resource types (pods, deployments, services, etc.)
  blockedResources?: string[];   // Blocked resource types
  allowedVerbs?: string[];       // Allowed verbs (get, list, watch, create, update, delete, etc.)
  blockedVerbs?: string[];       // Blocked verbs
  allowExec?: boolean;           // Allow kubectl exec
  allowPortForward?: boolean;    // Allow kubectl port-forward
  allowLogs?: boolean;           // Allow kubectl logs
  readOnly?: boolean;            // Read-only mode (only get, list, watch)
};

// Redis restrictions (for future Redis assets)
export type RedisRestrictions = {
  allowedCommands?: string[];    // Allowed Redis commands
  blockedCommands?: string[];    // Blocked Redis commands (e.g., FLUSHALL, FLUSHDB, DEBUG)
  allowedKeyPatterns?: string[]; // Allowed key patterns (glob)
  blockedKeyPatterns?: string[]; // Blocked key patterns
  readOnly?: boolean;            // Read-only mode
  maxKeysReturn?: number;        // Max keys to return in KEYS/SCAN
};

// Union type for all restrictions
export type AssetRestrictions =
  | ({ type: 'ssh' } & SSHRestrictions)
  | ({ type: 'local' } & LocalRestrictions)
  | ({ type: 'docker_host' } & DockerRestrictions)
  | ({ type: 'database' } & DatabaseRestrictions)
  | ({ type: 'k8s' } & K8sRestrictions)
  | ({ type: 'redis' } & RedisRestrictions)
  | { type: 'generic'; [key: string]: unknown };

export type SpaceAssetsConfig = {
  hosts: HostAssetConfig[];
  k8s: K8sAssetConfig[];
  // New: workspace asset references
  assets: WorkspaceAssetRef[];
};

// Tool types
export type ToolType =
  | "mcp-stdio"      // MCP via stdio (local process)
  | "mcp-sse"        // MCP via SSE (remote server)
  | "mcp-http"       // MCP via Streamable HTTP
  | "openapi"        // OpenAPI/REST API
  | "script"         // Local script (Python, Shell, Node.js)
  | "browser-service" // Cloud browser service (Browserless, BrowserBase, etc.)
  | "builtin";       // Built-in tools

// Runtime environment for tools that need to execute locally or in workspace
export type RuntimeEnv = "local" | "workspace";

// MCP stdio configuration
export type MCPStdioConfig = {
  command: string;           // Command to run (e.g. "npx", "python", "node")
  args?: string[];           // Command arguments (e.g. ["-y", "@modelcontextprotocol/server-filesystem"])
  env?: Record<string, string>; // Environment variables
  cwd?: string;              // Working directory
  runtimeEnv?: RuntimeEnv;   // Where to run: "local" (host machine) or "workspace" (container/pod)
};

// Authentication configuration for remote MCP servers
export type MCPAuthConfig = {
  type: "none" | "bearer" | "basic" | "apiKey" | "custom";
  token?: string;            // For bearer auth
  username?: string;         // For basic auth
  password?: string;         // For basic auth
  apiKey?: string;           // For API key auth
  apiKeyHeader?: string;     // Header name for API key (default: X-API-Key)
  customHeaders?: Record<string, string>; // For custom auth
};

// MCP SSE configuration (Server-Sent Events)
export type MCPSSEConfig = {
  url: string;               // SSE endpoint URL
  headers?: Record<string, string>; // Custom headers
  auth?: MCPAuthConfig;      // Authentication configuration
  timeout?: number;          // Connection timeout in ms
  reconnect?: boolean;       // Auto-reconnect on disconnect (default: true)
  reconnectInterval?: number; // Reconnect interval in ms (default: 1000)
};

// MCP HTTP configuration (Streamable HTTP)
export type MCPHTTPConfig = {
  url: string;               // HTTP endpoint URL
  headers?: Record<string, string>; // Custom headers
  auth?: MCPAuthConfig;      // Authentication configuration
  timeout?: number;          // Request timeout in ms
  retries?: number;          // Number of retries on failure (default: 3)
};

// OpenAPI configuration
export type OpenAPIConfig = {
  specUrl?: string;          // URL to OpenAPI spec (JSON/YAML)
  specContent?: string;      // Inline OpenAPI spec content
  baseUrl?: string;          // Override base URL
  headers?: Record<string, string>; // Default headers
  auth?: {
    type: "bearer" | "basic" | "apiKey";
    token?: string;          // For bearer
    username?: string;       // For basic
    password?: string;       // For basic
    apiKey?: string;         // For apiKey
    apiKeyHeader?: string;   // Header name for apiKey (default: X-API-Key)
  };
};

// Script configuration
export type ScriptConfig = {
  runtime: "python" | "node" | "shell" | "deno" | "bun";
  script?: string;           // Inline script content
  scriptPath?: string;       // Path to script file
  args?: string[];           // Script arguments
  env?: Record<string, string>; // Environment variables
  cwd?: string;              // Working directory
  timeout?: number;          // Execution timeout in ms
  runtimeEnv?: RuntimeEnv;   // Where to run: "local" (host machine) or "workspace" (container/pod)
};

// Built-in tool configuration
export type BuiltinConfig = {
  toolId: string;            // Built-in tool identifier
  options?: Record<string, unknown>; // Tool-specific options
};

// Browser service configuration (cloud browser providers)
export type BrowserServiceConfig = {
  provider: "browserless" | "browserbase" | "steel" | "hyperbrowser" | "custom";
  apiKey?: string;           // API key for the service
  endpoint?: string;         // Custom endpoint URL (for custom provider)
  // Common options
  headless?: boolean;        // Run in headless mode (default: true)
  timeout?: number;          // Page load timeout in ms
  viewport?: {
    width: number;
    height: number;
  };
  // Provider-specific options
  options?: Record<string, unknown>;
};

// Preset browser service providers
export const BROWSER_SERVICE_PROVIDERS = [
  {
    id: "browserless",
    name: "Browserless",
    description: "Scalable browser automation API",
    website: "https://browserless.io",
  },
  {
    id: "browserbase",
    name: "BrowserBase",
    description: "Headless browser infrastructure for AI agents",
    website: "https://browserbase.com",
  },
  {
    id: "steel",
    name: "Steel",
    description: "Browser API for AI applications",
    website: "https://steel.dev",
  },
  {
    id: "hyperbrowser",
    name: "Hyperbrowser",
    description: "AI-native browser platform",
    website: "https://hyperbrowser.ai",
  },
] as const;

// Preset MCP servers for quick selection
export const PRESET_MCP_SERVERS = [
  {
    id: "filesystem",
    name: "Filesystem",
    description: "Read/write files, search, and manage directories",
    type: "mcp-stdio" as const,
    config: { command: "npx", args: ["-y", "@modelcontextprotocol/server-filesystem", "/path/to/allowed/dir"] }
  },
  {
    id: "github",
    name: "GitHub",
    description: "Interact with GitHub repositories, issues, PRs",
    type: "mcp-stdio" as const,
    config: { command: "npx", args: ["-y", "@modelcontextprotocol/server-github"] }
  },
  {
    id: "postgres",
    name: "PostgreSQL",
    description: "Query and manage PostgreSQL databases",
    type: "mcp-stdio" as const,
    config: { command: "npx", args: ["-y", "@modelcontextprotocol/server-postgres"] }
  },
  {
    id: "sqlite",
    name: "SQLite",
    description: "Query and manage SQLite databases",
    type: "mcp-stdio" as const,
    config: { command: "npx", args: ["-y", "@modelcontextprotocol/server-sqlite", "/path/to/db.sqlite"] }
  },
  {
    id: "puppeteer",
    name: "Puppeteer",
    description: "Browser automation and web scraping",
    type: "mcp-stdio" as const,
    config: { command: "npx", args: ["-y", "@modelcontextprotocol/server-puppeteer"] }
  },
  {
    id: "slack",
    name: "Slack",
    description: "Interact with Slack workspaces",
    type: "mcp-stdio" as const,
    config: { command: "npx", args: ["-y", "@modelcontextprotocol/server-slack"] }
  },
  {
    id: "memory",
    name: "Memory",
    description: "Persistent memory for conversations",
    type: "mcp-stdio" as const,
    config: { command: "npx", args: ["-y", "@modelcontextprotocol/server-memory"] }
  },
  {
    id: "brave-search",
    name: "Brave Search",
    description: "Web search via Brave Search API",
    type: "mcp-stdio" as const,
    config: { command: "npx", args: ["-y", "@modelcontextprotocol/server-brave-search"] }
  },
  {
    id: "fetch",
    name: "Fetch",
    description: "Fetch and parse web pages",
    type: "mcp-stdio" as const,
    config: { command: "npx", args: ["-y", "@modelcontextprotocol/server-fetch"] }
  },
] as const;

// Built-in tools available
export const BUILTIN_TOOLS = [
  { id: "terminal", name: "Terminal", description: "Execute commands in workspace terminal" },
  { id: "file-browser", name: "File Browser", description: "Browse and manage files" },
  { id: "code-search", name: "Code Search", description: "Search code in workspace" },
  { id: "git", name: "Git", description: "Git operations (status, diff, commit, etc.)" },
  { id: "web-browser", name: "Web Browser", description: "Headless browser for web automation (local/Docker)" },
] as const;

// Tool configuration
export type ToolConfig = {
  id: string;
  name: string;
  type: ToolType;
  description?: string;
  enabled?: boolean;         // Enable/disable without removing
  // Type-specific configuration
  mcpStdio?: MCPStdioConfig;
  mcpSse?: MCPSSEConfig;
  mcpHttp?: MCPHTTPConfig;
  openapi?: OpenAPIConfig;
  script?: ScriptConfig;
  browserService?: BrowserServiceConfig;
  builtin?: BuiltinConfig;
  // AI hints for this tool
  aiHint?: string;
};

export type SpaceConfigInput = {
  name: string;
  description?: string;
  runtime: WorkspaceRuntime;
  assets: SpaceAssetsConfig;
  tools: ToolConfig[];
};

// Validate workspace name for K8s/DNS compatibility
// Must be lowercase, alphanumeric, hyphens allowed (not at start/end), max 63 chars
export const isValidWorkspaceName = (name: string): boolean => {
  if (!name || name.length > 63) return false;
  return /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(name) || /^[a-z0-9]$/.test(name);
};

export const sanitizeWorkspaceName = (name: string): string => {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-+/g, "-")
    .slice(0, 63);
};

export type ChatSession = {
  id: string;
  title: string;
  messages: ChatMessage[];
  createdAt: number;
  updatedAt: number;
  activeTools: ToolSession[];
};

export type ChatPane = {
  id: string;
  kind: "chat";
  title: string;
  sessions: ChatSession[];
  activeSessionId: string;
};

export type EditorPane = {
  id: string;
  kind: "editor";
  title: string;
  filePath: string;
  content: string;
  language?: string;
  dirty: boolean;
};

export type ToolPane = {
  id: string;
  kind: "tool";
  title: string;
  toolId: string;
  summary: string;
};

export type SpacePane = ChatPane | EditorPane | ToolPane;

export type ToolSession = {
  id: string;
  label: string;
  type: "terminal" | "browser" | "job";
  status: "running" | "idle" | "error";
  summary: string;
  endpoint?: { host: string; port: number };
  connectionTime?: number;
};

export type Room = {
  id: string;
  name: string;
  description?: string;
  environment: "Local" | "Remote";
  location: "Local" | "Remote" | "Docker" | "Pod";
  // IDE mode panes (editor, terminals opened in IDE mode)
  panes: SpacePane[];
  activePaneId: string;
  // Chat mode preview panes (terminals, editors opened by AI)
  chatPanes: SpacePane[];
  activeChatPaneId: string;
  toolSessions: ToolSession[];
};

// Work mode: chat (AI-driven) or ide (developer IDE)
export type WorkMode = "chat" | "ide";

export type Workspace = {
  id: string;
  name: string;
  description?: string;
  status: "running" | "stopped" | "starting" | "stopping" | "error";
  color: string;
  // Work mode: AI chat or IDE development
  workMode: WorkMode;
  // Runtime environment configuration
  runtime: WorkspaceRuntime;
  // Associated assets for this workspace
  assets: SpaceAssetsConfig;
  tools: ToolConfig[];
  rooms: Room[];
  activeRoomId: string;
  // File tree loaded from runtime environment (not persisted)
  fileTree: FileNode[];
  fileTreeLoading?: boolean;
};

export interface WorkspaceContextValue {
  workspaces: Workspace[];
  activeWorkspaceId?: string;
  activeWorkspace?: Workspace;
  activeRoom?: Room;
  // File tree from active workspace runtime
  fileTree: FileNode[];
  fileTreeLoading: boolean;
  refreshFileTree: () => Promise<void>;
  selectWorkspace: (id: string) => void;
  createWorkspace: () => void;
  renameWorkspace: (workspaceId: string, name: string) => void;
  deleteWorkspace: (workspaceId: string) => Promise<void>;
  createWorkspaceWithConfig: (config: SpaceConfigInput) => void;
  updateWorkspaceConfig: (workspaceId: string, config: SpaceConfigInput) => void;
  startWorkspace: (workspaceId: string) => Promise<void>;
  stopWorkspace: (workspaceId: string) => Promise<void>;
  selectRoom: (roomId: string) => void;
  createRoom: () => void;
  renameRoom: (roomId: string, name: string) => void;
  deleteRoom: (roomId: string) => void;
  duplicateRoom: (roomId: string) => void;
  setActivePane: (paneId: string) => void;
  closePane: (paneId: string) => void;
  // File operations
  openFileFromTree: (filePath: string) => void;
  updateEditorContent: (paneId: string, content: string) => void;
  saveEditorContent: (paneId: string) => void;
  addFileNode: (
    parentPath: string | null,
    nodeType: "file" | "folder",
    name: string,
  ) => void;
  deleteFileNode: (path: string) => void;
  renameFileNode: (path: string, newName: string) => void;
  // Chat operations
  sendChatMessage: (paneId: string, content: string) => void;
  setActiveChatSession: (paneId: string, sessionId: string) => void;
  createChatSession: (paneId: string) => void;
  renameChatSession: (paneId: string, sessionId: string, title: string) => void;
  deleteChatSession: (paneId: string, sessionId: string) => void;
  // Tool operations
  startToolPreview: (toolId: string) => void;
  openTerminalTab: () => void;
  // Work mode
  setWorkMode: (mode: WorkMode) => void;
  // Chat mode preview pane operations
  openChatTerminal: () => void;
  setChatActivePane: (paneId: string) => void;
  closeChatPane: (paneId: string) => void;
}


const WorkspaceContext = createContext<WorkspaceContextValue | undefined>(
  undefined,
);

const palette = ["#4f46e5", "#0ea5e9", "#10b981", "#f97316"];

const seedChat = (toolSessions?: ToolSession[]): ChatPane => {
  const initialSession: ChatSession = {
    id: uuid(),
    title: "Session 1",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    messages: [
      {
        id: uuid(),
        role: "assistant",
        content: "Space is ready. Ask me to run terminals, AI tools, and file updates inside the space.",
        timestamp: Date.now() - 1000 * 60 * 5,
      },
    ],
    activeTools: toolSessions ? toolSessions.slice(0, 2) : [],
  };
  return {
    id: uuid(),
    kind: "chat",
    title: "AI Chat",
    sessions: [initialSession],
    activeSessionId: initialSession.id,
  };
};

const seedEditor = (): EditorPane => ({
  id: uuid(),
  kind: "editor",
  title: "README.md",
  filePath: "/services/orchestrator/README.md",
  content:
    "# Orchestrator\nCoordinates terminals, AI tools, and file updates inside the space.\n",
  language: "markdown",
  dirty: false,
});

const seedToolSessions = (): ToolSession[] => [
  {
    id: uuid(),
    label: "Ops Terminal",
    type: "terminal",
    status: "running",
    summary: "ssh ops@staging cluster",
    endpoint: { host: "10.0.3.12", port: 22 },
    connectionTime: Date.now() - 1000 * 60 * 7,
  },
  {
    id: uuid(),
    label: "Docs Browser",
    type: "browser",
    status: "idle",
    summary: "wss://docs.internal/search",
  },
];

const createRoom = (name: string): Room => {
  const toolSessions = seedToolSessions();
  const chatPane = seedChat(toolSessions);
  const editorPane = seedEditor();
  return {
    id: uuid(),
    name,
    description: "Local space scoped to ops files",
    environment: "Local",
    location: "Local",
    // Manual mode: starts with chat and welcome editor
    panes: [chatPane, editorPane],
    activePaneId: chatPane.id,
    // Chat mode: starts empty, AI will open terminals/editors as needed
    chatPanes: [],
    activeChatPaneId: "",
    toolSessions,
  };
};

const createDefaultRuntime = (workspaceName: string): WorkspaceRuntime => ({
  type: "local",
  workDir: {
    path: `~/.choraleia/workspaces/${sanitizeWorkspaceName(workspaceName)}`,
  },
});

const createWorkspace = (name: string, colorIndex: number): Workspace => {
  const firstRoom = createRoom(`${name} Space`);
  const sanitizedName = sanitizeWorkspaceName(name);
  return {
    id: uuid(),
    name: sanitizedName,
    status: "stopped",
    color: palette[colorIndex % palette.length],
    workMode: "chat",  // Default to chat mode
    runtime: createDefaultRuntime(sanitizedName),
    assets: { hosts: [], k8s: [], assets: [] },
    tools: [],
    rooms: [firstRoom],
    activeRoomId: firstRoom.id,
    fileTree: [],  // Will be loaded from runtime environment
    fileTreeLoading: false,
  };
};

const seedWorkspaces = (): Workspace[] => [createWorkspace("ops-research", 0)];

export const createRoomConfigTemplate = (name = "new-space"): SpaceConfigInput => ({
  name: sanitizeWorkspaceName(name),
  description: "",
  runtime: createDefaultRuntime(name),
  assets: {
    hosts: [],
    k8s: [],
    assets: [],
  },
  tools: [],
});

const ensureChatPane = (pane: any, availableTools: ToolSession[] = []): ChatPane => {
  const fallbackTools = availableTools.slice(0, 2);
  const normalizedPane: ChatPane = pane.sessions && pane.activeSessionId
    ? ({
        ...pane,
        sessions: pane.sessions.map((session: ChatSession) => ({
          ...session,
          activeTools:
            Array.isArray(session.activeTools) && session.activeTools.length > 0
              ? session.activeTools
              : fallbackTools,
        })),
      } as ChatPane)
    : (() => {
        const legacyMessages: ChatMessage[] = pane.messages || [];
        const sessionId = uuid();
        return {
          id: pane.id || uuid(),
          kind: "chat",
          title: pane.title || "AI Chat",
          sessions: [
            {
              id: sessionId,
              title: "Session 1",
              createdAt: Date.now(),
              updatedAt: Date.now(),
              messages: legacyMessages,
              activeTools: fallbackTools,
            },
          ],
          activeSessionId: sessionId,
        };
      })();
  return normalizedPane;
};

const normalizeWorkspace = (workspace: Workspace): Workspace => ({
  ...workspace,
  description: workspace.description || "",
  runtime: workspace.runtime || createDefaultRuntime(workspace.name),
  assets: workspace.assets || { hosts: [], k8s: [] },
  tools: workspace.tools || [],
  rooms: workspace.rooms.map((space) => ({
    ...space,
    panes: space.panes.map((pane) =>
      pane.kind === "chat"
        ? ensureChatPane(pane, space.toolSessions)
        : pane,
    ),
  })),
});

const findFileNode = (nodes: FileNode[], path: string): FileNode | undefined => {
  for (const node of nodes) {
    if (node.path === path) return node;
    if (node.children) {
      const match = findFileNode(node.children, path);
      if (match) return match;
    }
  }
  return undefined;
};

const updateFileContent = (
  nodes: FileNode[],
  targetPath: string,
  content: string,
): FileNode[] =>
  nodes.map((node) => {
    if (node.path === targetPath && node.type === "file") {
      return { ...node, content };
    }
    if (node.children) {
      return { ...node, children: updateFileContent(node.children, targetPath, content) };
    }
    return node;
  });

const appendNode = (
  nodes: FileNode[],
  parentPath: string | null,
  newNode: FileNode,
): FileNode[] => {
  if (!parentPath) return [...nodes, newNode];
  return nodes.map((node) => {
    if (node.path === parentPath && node.type === "folder") {
      const children = node.children ? [...node.children, newNode] : [newNode];
      return { ...node, children };
    }
    if (node.children) {
      return { ...node, children: appendNode(node.children, parentPath, newNode) };
    }
    return node;
  });
};

const deleteNode = (nodes: FileNode[], targetPath: string): FileNode[] => {
  return nodes
    .filter((node) => node.path !== targetPath)
    .map((node) => {
      if (node.children) {
        return { ...node, children: deleteNode(node.children, targetPath) };
      }
      return node;
    });
};

const renameNode = (
  nodes: FileNode[],
  targetPath: string,
  newName: string,
): FileNode[] => {
  return nodes.map((node) => {
    if (node.path === targetPath) {
      const parentPath = targetPath.substring(0, targetPath.lastIndexOf("/")) || "";
      const newPath = `${parentPath}/${newName}`.replace(/\/+/g, "/");
      // If folder, update all children paths recursively
      if (node.type === "folder" && node.children) {
        const updateChildPaths = (children: FileNode[], oldBase: string, newBase: string): FileNode[] =>
          children.map((child) => {
            const newChildPath = child.path.replace(oldBase, newBase);
            return {
              ...child,
              path: newChildPath,
              children: child.children ? updateChildPaths(child.children, oldBase, newBase) : undefined,
            };
          });
        return {
          ...node,
          name: newName,
          path: newPath,
          children: updateChildPaths(node.children, targetPath, newPath),
        };
      }
      return { ...node, name: newName, path: newPath };
    }
    if (node.children) {
      return { ...node, children: renameNode(node.children, targetPath, newName) };
    }
    return node;
  });
};

// Convert backend workspace format to frontend format
const convertBackendWorkspace = (ws: workspacesApi.Workspace): Workspace => {

  const rooms: Room[] = (ws.rooms || []).map((r) => {
    // Get panes from layout, or create default panes
    let panes = r.layout?.panes as SpacePane[] || [];
    let activePaneId = r.active_pane_id || "";

    // Ensure at least a chat pane exists
    if (panes.length === 0 || !panes.some(p => p.kind === "chat")) {
      const chatPane = seedChat([]);
      panes = [chatPane, ...panes];
      if (!activePaneId) {
        activePaneId = chatPane.id;
      }
    }

    return {
      id: r.id,
      name: r.name,
      description: r.description,
      environment: "Local" as const,
      location: "Local" as const,
      panes,
      activePaneId,
      chatPanes: [],
      activeChatPaneId: "",
      toolSessions: [],
    };
  });

  // Ensure at least one room exists
  if (rooms.length === 0) {
    rooms.push(createRoom("Main"));
  }

  return {
    id: ws.id,
    name: ws.name,
    description: ws.description,
    status: ws.status,
    color: ws.color || palette[0],
    runtime: ws.runtime ? {
      type: ws.runtime.type,
      dockerAssetId: ws.runtime.docker_asset_id,
      containerMode: ws.runtime.container_mode,
      containerId: ws.runtime.container_id,
      containerName: ws.runtime.container_name,
      newContainer: ws.runtime.new_container_image ? {
        image: ws.runtime.new_container_image,
        name: ws.runtime.new_container_name,
      } : undefined,
      workDir: {
        path: ws.runtime.work_dir_path,
        containerPath: ws.runtime.work_dir_container_path,
      },
    } : {
      type: "local",
      workDir: { path: "" },
    },
    assets: {
      hosts: [],
      k8s: [],
      assets: (ws.assets || []).map((a) => ({
        id: a.id,
        assetId: a.asset_id,
        assetType: a.asset_type,
        assetName: a.asset_name,
        aiHint: a.ai_hint,
        restrictions: a.restrictions as AssetRestrictions | undefined,
      })),
    },
    tools: (ws.tools || []).map((t) => {
      // Backend stores config with type prefix (mcp_stdio, mcp_sse, etc.)
      const config = t.config || {};
      return {
        id: t.id,
        name: t.name,
        type: t.type as ToolType,
        description: t.description,
        enabled: t.enabled,
        aiHint: t.ai_hint,
        // Parse config based on tool type - check both nested and flat formats
        mcpStdio: t.type === "mcp-stdio" ? (config.mcp_stdio || config) as MCPStdioConfig : undefined,
        mcpSse: t.type === "mcp-sse" ? (config.mcp_sse || config) as MCPSSEConfig : undefined,
        mcpHttp: t.type === "mcp-http" ? (config.mcp_http || config) as MCPHTTPConfig : undefined,
        openapi: t.type === "openapi" ? (config.openapi || config) as OpenAPIConfig : undefined,
        script: t.type === "script" ? (config.script || config) as ScriptConfig : undefined,
        browserService: t.type === "browser-service" ? (config.browser_service || config) as BrowserServiceConfig : undefined,
        builtin: t.type === "builtin" ? (config.builtin || config) as BuiltinConfig : undefined,
      };
    }),
    rooms,
    activeRoomId: ws.active_room_id || rooms[0]?.id || "",
    workMode: "chat",  // Default to chat mode
    fileTree: [],  // Will be loaded from runtime environment
    fileTreeLoading: false,
  };
};

// Convert frontend workspace format to backend request format
const convertToBackendRequest = (ws: Workspace): workspacesApi.CreateWorkspaceRequest => {
  return {
    name: ws.name,
    description: ws.description,
    color: ws.color,
    runtime: ws.runtime ? {
      type: ws.runtime.type,
      docker_asset_id: ws.runtime.dockerAssetId,
      container_mode: ws.runtime.containerMode,
      container_id: ws.runtime.containerId,
      new_container_image: ws.runtime.newContainer?.image,
      new_container_name: ws.runtime.newContainer?.name,
      work_dir_path: ws.runtime.workDir.path,
      work_dir_container_path: ws.runtime.workDir.containerPath,
    } : undefined,
    assets: ws.assets.assets.map((a) => ({
      asset_id: a.assetId,
      ai_hint: a.aiHint,
      restrictions: a.restrictions as Record<string, unknown>,
    })),
    tools: ws.tools.map((t) => ({
      name: t.name,
      type: t.type,
      description: t.description,
      enabled: t.enabled,
      ai_hint: t.aiHint,
      config: {
        // Include type-specific config
        ...(t.mcpStdio && { mcp_stdio: t.mcpStdio }),
        ...(t.mcpSse && { mcp_sse: t.mcpSse }),
        ...(t.mcpHttp && { mcp_http: t.mcpHttp }),
        ...(t.openapi && { openapi: t.openapi }),
        ...(t.script && { script: t.script }),
        ...(t.browserService && { browser_service: t.browserService }),
        ...(t.builtin && { builtin: t.builtin }),
      },
    })),
  };
};

export const WorkspaceProvider: React.FC<React.PropsWithChildren> = ({
  children,
}) => {
  // Start with empty, will be populated from backend
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string>("");
  const [isLoading, setIsLoading] = useState(true);

  // Load workspaces from backend on mount
  useEffect(() => {
    const loadWorkspaces = async () => {
      try {
        const backendWorkspaces = await workspacesApi.listWorkspaces();
        if (backendWorkspaces.length > 0) {
          // Fetch full details for each workspace
          const fullWorkspaces = await Promise.all(
            backendWorkspaces.map(async (item) => {
              try {
                const ws = await workspacesApi.getWorkspace(item.id);
                return convertBackendWorkspace(ws);
              } catch {
                return null;
              }
            })
          );
          const validWorkspaces = fullWorkspaces.filter((ws): ws is Workspace => ws !== null);
          if (validWorkspaces.length > 0) {
            setWorkspaces(validWorkspaces);
            setActiveWorkspaceId(validWorkspaces[0].id);
          } else {
            // All fetches failed, use seed
            const seeded = seedWorkspaces();
            setWorkspaces(seeded);
            setActiveWorkspaceId(seeded[0].id);
          }
        } else {
          // No workspaces in backend, use seed
          const seeded = seedWorkspaces();
          setWorkspaces(seeded);
          setActiveWorkspaceId(seeded[0].id);
        }
      } catch (err) {
        console.warn("Failed to load workspaces from backend:", err);
        // Fallback to seed workspace
        const seeded = seedWorkspaces();
        setWorkspaces(seeded);
        setActiveWorkspaceId(seeded[0].id);
      } finally {
        setIsLoading(false);
      }
    };
    loadWorkspaces();
  }, []);


  const activeWorkspace = useMemo(
    () => workspaces.find((ws) => ws.id === activeWorkspaceId),
    [workspaces, activeWorkspaceId],
  );

  const activeRoom = useMemo(() => {
    if (!activeWorkspace) return undefined;
    return activeWorkspace.rooms.find(
      (space) => space.id === activeWorkspace.activeRoomId,
    );
  }, [activeWorkspace]);

  // File tree from active workspace
  const fileTree = useMemo(() => activeWorkspace?.fileTree || [], [activeWorkspace]);
  const fileTreeLoading = useMemo(() => activeWorkspace?.fileTreeLoading || false, [activeWorkspace]);

  // Helper: Convert FSEntry to FileNode
  const fsEntryToFileNode = useCallback((entry: FSEntry, children?: FileNode[]): FileNode => ({
    id: uuid(),
    name: entry.name,
    path: entry.path,
    type: entry.is_dir ? "folder" : "file",
    children: entry.is_dir ? children || [] : undefined,
  }), []);

  // Helper: Load directory tree recursively (max 2 levels deep for performance)
  const loadDirectoryTree = useCallback(async (
    basePath: string,
    depth: number,
    maxDepth: number,
    assetId?: string,
    containerId?: string,
  ): Promise<FileNode[]> => {
    try {
      const result = await fsList({
        assetId,
        containerId,
        path: basePath,
        includeHidden: false,
      });

      const nodes: FileNode[] = [];
      for (const entry of result.entries) {
        if (entry.is_dir && depth < maxDepth) {
          // Recursively load subdirectory
          const children = await loadDirectoryTree(
            entry.path,
            depth + 1,
            maxDepth,
            assetId,
            containerId,
          );
          nodes.push(fsEntryToFileNode(entry, children));
        } else {
          nodes.push(fsEntryToFileNode(entry));
        }
      }
      return nodes;
    } catch (err) {
      console.warn(`Failed to load directory ${basePath}:`, err);
      return [];
    }
  }, [fsEntryToFileNode]);

  // Load file tree for a workspace from its runtime environment
  const loadFileTreeForWorkspace = useCallback(async (workspace: Workspace) => {
    const { runtime } = workspace;

    // Set loading state
    setWorkspaces((prev) =>
      prev.map((ws) =>
        ws.id === workspace.id ? { ...ws, fileTreeLoading: true } : ws
      )
    );

    try {
      let assetId: string | undefined;
      let containerIdentifier: string | undefined;
      let basePath = runtime.workDir.path;

      // Determine how to access files based on runtime type
      if (runtime.type === "local") {
        // Local filesystem - no assetId needed, use workDir path
        // Expand ~ to home directory hint (backend will handle this)
        if (basePath.startsWith("~")) {
          basePath = basePath.replace("~", "/home");  // Backend should handle this properly
        }
      } else if (runtime.type === "docker-local" || runtime.type === "docker-remote") {
        // Docker container - need assetId and container identifier
        assetId = runtime.dockerAssetId;
        // Use containerName if available, otherwise containerId, otherwise generate default name
        containerIdentifier = runtime.containerName || runtime.containerId ||
          (runtime.containerMode === "new" ? `choraleia-${workspace.name}` : undefined);
        basePath = runtime.workDir.containerPath || runtime.workDir.path || "/";
      }

      // Load file tree (max 2 levels deep)
      const tree = await loadDirectoryTree(basePath, 0, 2, assetId, containerIdentifier);

      // Update workspace with file tree
      setWorkspaces((prev) =>
        prev.map((ws) =>
          ws.id === workspace.id
            ? { ...ws, fileTree: tree, fileTreeLoading: false }
            : ws
        )
      );
    } catch (err) {
      console.error("Failed to load file tree:", err);
      setWorkspaces((prev) =>
        prev.map((ws) =>
          ws.id === workspace.id ? { ...ws, fileTree: [], fileTreeLoading: false } : ws
        )
      );
    }
  }, [loadDirectoryTree]);

  // Refresh file tree for active workspace
  const refreshFileTree = useCallback(async () => {
    if (activeWorkspace) {
      // Clear the loaded flag to allow fresh load
      setLoadedWorkspaceIds((prev) => {
        const next = new Set(prev);
        next.delete(activeWorkspace.id);
        return next;
      });
      await loadFileTreeForWorkspace(activeWorkspace);
      // Mark as loaded again
      setLoadedWorkspaceIds((prev) => new Set(prev).add(activeWorkspace.id));
    }
  }, [activeWorkspace, loadFileTreeForWorkspace]);

  // Track which workspaces have been loaded to avoid repeated attempts
  const [loadedWorkspaceIds, setLoadedWorkspaceIds] = useState<Set<string>>(new Set());

  // Auto-load file tree when active workspace changes
  useEffect(() => {
    if (
      activeWorkspace &&
      activeWorkspace.fileTree.length === 0 &&
      !activeWorkspace.fileTreeLoading &&
      !loadedWorkspaceIds.has(activeWorkspace.id)
    ) {
      // Mark as loaded to prevent repeated attempts
      setLoadedWorkspaceIds((prev) => new Set(prev).add(activeWorkspace.id));
      loadFileTreeForWorkspace(activeWorkspace);
    }
  }, [activeWorkspace?.id, activeWorkspace?.fileTree.length, activeWorkspace?.fileTreeLoading, loadedWorkspaceIds]);

  const mutateActiveWorkspace = useCallback(
    (mutator: (workspace: Workspace) => Workspace) => {
      if (!activeWorkspaceId) return;
      setWorkspaces((prev) =>
        prev.map((ws) => (ws.id === activeWorkspaceId ? mutator(ws) : ws)),
      );
    },
    [activeWorkspaceId],
  );

  const mutateRoom = useCallback(
    (roomId: string | undefined, mutator: (room: Room) => Room) => {
      if (!roomId) return;
      mutateActiveWorkspace((workspace) => ({
        ...workspace,
        rooms: workspace.rooms.map((room) =>
          room.id === roomId ? mutator(room) : room,
        ),
      }));
    },
    [mutateActiveWorkspace],
  );

  const selectWorkspace = useCallback((id: string) => {
    if (!workspaces.some((ws) => ws.id === id)) return;
    setActiveWorkspaceId(id);
  }, [workspaces]);

  const createWorkspaceWithConfig = useCallback(
    async (config: SpaceConfigInput) => {
      // Create optimistic local workspace first
      const newRoom = createRoom(`${config.name} Space`);
      const optimisticWorkspace: Workspace = {
        id: uuid(),
        name: config.name,
        description: config.description,
        status: "stopped",
        color: palette[workspaces.length % palette.length],
        workMode: "chat",  // Default to chat mode
        runtime: config.runtime,
        assets: config.assets,
        tools: config.tools,
        rooms: [newRoom],
        activeRoomId: newRoom.id,
        fileTree: [],
        fileTreeLoading: false,
      };

      // Add optimistically
      setWorkspaces((prev) => [...prev, optimisticWorkspace]);
      setActiveWorkspaceId(optimisticWorkspace.id);

      try {
        // Create on backend
        const backendReq = convertToBackendRequest(optimisticWorkspace);
        const created = await workspacesApi.createWorkspace(backendReq);

        // Update with real ID from backend
        const realWorkspace = convertBackendWorkspace(created);
        setWorkspaces((prev) =>
          prev.map((ws) => (ws.id === optimisticWorkspace.id ? realWorkspace : ws))
        );
        setActiveWorkspaceId(realWorkspace.id);
      } catch (err) {
        console.error("Failed to create workspace on backend:", err);
        // Keep local workspace, it will be synced later
      }
    },
    [workspaces.length],
  );

  const createWorkspaceHandler = useCallback(() => {
    const nextIndex = workspaces.length + 1;
    createWorkspaceWithConfig(createRoomConfigTemplate(`workspace-${nextIndex}`));
  }, [createWorkspaceWithConfig, workspaces.length]);

  const updateWorkspaceConfig = useCallback(
    async (workspaceId: string, config: SpaceConfigInput) => {

      // Update locally first (optimistic)
      setWorkspaces((prev) =>
        prev.map((workspace) =>
          workspace.id === workspaceId
            ? {
                ...workspace,
                name: config.name,
                description: config.description,
                runtime: config.runtime,
                assets: config.assets,
                tools: config.tools,
              }
            : workspace,
        ),
      );

      try {
        // Build the request payload
        const requestPayload = {
          name: config.name,
          description: config.description,
          runtime: config.runtime ? {
            type: config.runtime.type,
            docker_asset_id: config.runtime.dockerAssetId,
            container_mode: config.runtime.containerMode,
            container_id: config.runtime.containerId,
            new_container_image: config.runtime.newContainer?.image,
            new_container_name: config.runtime.newContainer?.name,
            work_dir_path: config.runtime.workDir.path,
            work_dir_container_path: config.runtime.workDir.containerPath,
          } : undefined,
          // Convert assets to API format
          assets: config.assets.assets?.map((a) => ({
            asset_id: a.assetId,
            ai_hint: a.aiHint,
            restrictions: a.restrictions as Record<string, unknown>,
          })),
          // Convert tools to API format
          tools: config.tools?.map((t) => ({
            name: t.name,
            type: t.type,
            description: t.description,
            enabled: t.enabled ?? true,
            ai_hint: t.aiHint,
            config: {
              // Include type-specific config
              ...(t.mcpStdio && { mcp_stdio: t.mcpStdio }),
              ...(t.mcpSse && { mcp_sse: t.mcpSse }),
              ...(t.mcpHttp && { mcp_http: t.mcpHttp }),
              ...(t.openapi && { openapi: t.openapi }),
              ...(t.script && { script: t.script }),
              ...(t.browserService && { browser_service: t.browserService }),
              ...(t.builtin && { builtin: t.builtin }),
            },
          })),
        };

        // Sync to backend
        const updatedWorkspace = await workspacesApi.updateWorkspace(workspaceId, requestPayload);

        // Update local state with the actual response from backend
        const convertedWorkspace = convertBackendWorkspace(updatedWorkspace);
        setWorkspaces((prev) =>
          prev.map((workspace) =>
            workspace.id === workspaceId
              ? { ...workspace, ...convertedWorkspace, rooms: workspace.rooms, activeRoomId: workspace.activeRoomId }
              : workspace,
          ),
        );
      } catch (err) {
        console.error("Failed to update workspace on backend:", err);
        // TODO: Rollback optimistic update on error
      }
    },
    [],
  );

  // Poll workspace status after async operations
  const pollWorkspaceStatus = useCallback(
    (workspaceId: string, maxAttempts = 60, interval = 2000) => {
      let attempts = 0;
      const poll = async () => {
        attempts++;
        try {
          const res = await fetch(`/api/workspaces/${workspaceId}/status`);
          if (!res.ok) return;

          const data = await res.json();
          const newStatus = data.status as "running" | "stopped" | "starting" | "stopping" | "error";

          setWorkspaces((prev) =>
            prev.map((ws) =>
              ws.id === workspaceId ? { ...ws, status: newStatus } : ws
            )
          );

          // Keep polling if still in transition state
          if ((newStatus === "starting" || newStatus === "stopping") && attempts < maxAttempts) {
            setTimeout(poll, interval);
          }
        } catch (err) {
          console.error("Failed to poll workspace status:", err);
          // Retry on error if we haven't exceeded max attempts
          if (attempts < maxAttempts) {
            setTimeout(poll, interval);
          }
        }
      };

      // Start polling after a short delay
      setTimeout(poll, 1000);
    },
    [],
  );

  const startWorkspace = useCallback(
    async (workspaceId: string) => {
      // Update status to starting
      setWorkspaces((prev) =>
        prev.map((ws) =>
          ws.id === workspaceId ? { ...ws, status: "starting" as const } : ws
        )
      );
      try {
        // Call backend API to start workspace
        const res = await fetch(`/api/workspaces/${workspaceId}/start`, { method: 'POST' });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || 'Failed to start workspace');
        }

        // API returns 202 Accepted - operation is async
        // Keep status as "starting" and poll for actual status
        pollWorkspaceStatus(workspaceId);
      } catch (error) {
        setWorkspaces((prev) =>
          prev.map((ws) =>
            ws.id === workspaceId ? { ...ws, status: "error" as const } : ws
          )
        );
        throw error;
      }
    },
    [pollWorkspaceStatus],
  );

  const stopWorkspace = useCallback(
    async (workspaceId: string) => {
      // Update status to stopping
      setWorkspaces((prev) =>
        prev.map((ws) =>
          ws.id === workspaceId ? { ...ws, status: "stopping" as const } : ws
        )
      );
      try {
        // Call backend API to stop workspace
        const res = await fetch(`/api/workspaces/${workspaceId}/stop`, { method: 'POST' });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || 'Failed to stop workspace');
        }

        // API returns 202 Accepted - operation is async
        // Keep status as "stopping" and poll for actual status
        pollWorkspaceStatus(workspaceId);
      } catch (error) {
        setWorkspaces((prev) =>
          prev.map((ws) =>
            ws.id === workspaceId ? { ...ws, status: "error" as const } : ws
          )
        );
        throw error;
      }
    },
    [pollWorkspaceStatus],
  );

  const renameWorkspace = useCallback(
    async (workspaceId: string, name: string) => {
      // Update locally first
      setWorkspaces((prev) =>
        prev.map((ws) => (ws.id === workspaceId ? { ...ws, name } : ws)),
      );

      try {
        await workspacesApi.updateWorkspace(workspaceId, { name });
      } catch (err) {
        console.error("Failed to rename workspace on backend:", err);
      }
    },
    [],
  );

  const deleteWorkspace = useCallback(
    async (workspaceId: string) => {
      try {
        await workspacesApi.deleteWorkspace(workspaceId, true);

        // Remove from local state
        setWorkspaces((prev) => {
          const newWorkspaces = prev.filter((ws) => ws.id !== workspaceId);
          // If deleted workspace was active, select another one
          if (activeWorkspaceId === workspaceId && newWorkspaces.length > 0) {
            setActiveWorkspaceId(newWorkspaces[0].id);
          }
          return newWorkspaces;
        });
      } catch (err) {
        console.error("Failed to delete workspace:", err);
        throw err;
      }
    },
    [activeWorkspaceId],
  );

  const selectRoom = useCallback(
    async (roomId: string) => {
      const workspace = activeWorkspace;
      if (!workspace || !workspace.rooms.some((s) => s.id === roomId)) return;

      mutateActiveWorkspace((ws) => ({ ...ws, activeRoomId: roomId }));

      try {
        await workspacesApi.activateRoom(workspace.id, roomId);
      } catch (err) {
        console.error("Failed to activate room on backend:", err);
      }
    },
    [activeWorkspace, mutateActiveWorkspace],
  );

  const createRoomHandler = useCallback(async () => {
    const workspace = activeWorkspace;
    if (!workspace) return;

    const roomName = `Room ${workspace.rooms.length + 1}`;
    const newRoom = createRoom(roomName);

    // Add locally first
    mutateActiveWorkspace((ws) => ({
      ...ws,
      rooms: [...ws.rooms, newRoom],
      activeRoomId: newRoom.id,
    }));

    try {
      const created = await workspacesApi.createRoom(workspace.id, roomName);
      // Update with real ID from backend
      setWorkspaces((prev) =>
        prev.map((ws) =>
          ws.id === workspace.id
            ? {
                ...ws,
                rooms: ws.rooms.map((r) =>
                  r.id === newRoom.id ? { ...r, id: created.id } : r
                ),
                activeRoomId: created.id,
              }
            : ws
        )
      );
    } catch (err) {
      console.error("Failed to create room on backend:", err);
    }
  }, [activeWorkspace, mutateActiveWorkspace]);

  const renameRoomHandler = useCallback(
    async (roomId: string, name: string) => {
      const workspace = activeWorkspace;
      if (!workspace) return;

      mutateRoom(roomId, (room) => ({ ...room, name }));

      try {
        await workspacesApi.updateRoom(workspace.id, roomId, { name });
      } catch (err) {
        console.error("Failed to rename room on backend:", err);
      }
    },
    [activeWorkspace, mutateRoom],
  );

  const deleteRoomHandler = useCallback(
    async (roomId: string) => {
      const workspace = activeWorkspace;
      if (!workspace) return;

      // Don't delete if it's the only room
      if (workspace.rooms.length <= 1) return;

      const newRooms = workspace.rooms.filter((s) => s.id !== roomId);
      const newActiveRoomId =
        workspace.activeRoomId === roomId
          ? newRooms[0]?.id || ""
          : workspace.activeRoomId;

      mutateActiveWorkspace((ws) => ({
        ...ws,
        rooms: newRooms,
        activeRoomId: newActiveRoomId,
      }));

      try {
        await workspacesApi.deleteRoom(workspace.id, roomId);
      } catch (err) {
        console.error("Failed to delete room on backend:", err);
      }
    },
    [activeWorkspace, mutateActiveWorkspace],
  );

  const duplicateRoomHandler = useCallback(
    async (roomId: string) => {
      const workspace = activeWorkspace;
      if (!workspace) return;

      const sourceRoom = workspace.rooms.find((s) => s.id === roomId);
      if (!sourceRoom) return;

      const newName = `${sourceRoom.name} (Copy)`;
      const duplicatedRoom: Room = {
        ...JSON.parse(JSON.stringify(sourceRoom)), // Deep clone
        id: uuid(),
        name: newName,
      };
      // Regenerate IDs for panes
      duplicatedRoom.panes = duplicatedRoom.panes.map((pane) => ({
        ...pane,
        id: uuid(),
      }));
      duplicatedRoom.activePaneId = duplicatedRoom.panes[0]?.id || "";

      mutateActiveWorkspace((ws) => ({
        ...ws,
        rooms: [...ws.rooms, duplicatedRoom],
        activeRoomId: duplicatedRoom.id,
      }));

      try {
        const cloned = await workspacesApi.cloneRoom(workspace.id, roomId, newName);
        // Update with real ID from backend
        setWorkspaces((prev) =>
          prev.map((ws) =>
            ws.id === workspace.id
              ? {
                  ...ws,
                  rooms: ws.rooms.map((r) =>
                    r.id === duplicatedRoom.id ? { ...r, id: cloned.id } : r
                  ),
                  activeRoomId: cloned.id,
                }
              : ws
          )
        );
      } catch (err) {
        console.error("Failed to clone room on backend:", err);
      }
    },
    [activeWorkspace, mutateActiveWorkspace],
  );

  const setActivePane = useCallback(
    (paneId: string) => {
      mutateRoom(activeRoom?.id, (space) => ({
        ...space,
        activePaneId: paneId,
      }));
    },
    [activeRoom?.id, mutateRoom],
  );

  const closePane = useCallback(
    (paneId: string) => {
      mutateRoom(activeRoom?.id, (space) => {
        const pane = space.panes.find((p) => p.id === paneId);
        if (!pane || pane.kind === "chat") return space;
        const remaining = space.panes.filter((p) => p.id !== paneId);
        const nextActive =
          space.activePaneId === paneId
            ? remaining.find((p) => p.kind === "chat")?.id || remaining[0]?.id
            : space.activePaneId;
        return {
          ...space,
          panes: remaining,
          activePaneId: nextActive || space.activePaneId,
        };
      });
    },
    [activeRoom?.id, mutateRoom],
  );

  const openFileFromTree = useCallback(
    async (filePath: string) => {
      if (!activeWorkspace) return;

      // Check if file is already open
      const room = activeWorkspace.rooms.find(r => r.id === activeRoom?.id);
      const existing = room?.panes.find(
        (pane) => pane.kind === "editor" && pane.filePath === filePath,
      );
      if (existing) {
        mutateRoom(activeRoom?.id, (space) => ({
          ...space,
          activePaneId: existing.id,
        }));
        return;
      }

      // Find node in workspace-level fileTree to get the file name
      const node = findFileNode(activeWorkspace.fileTree, filePath);
      if (!node || node.type !== "file") return;

      const { runtime } = activeWorkspace;

      // Determine API params based on runtime type
      let assetId: string | undefined;
      let containerIdentifier: string | undefined;

      if (runtime.type === "docker-local" || runtime.type === "docker-remote") {
        assetId = runtime.dockerAssetId;
        // Use containerName if available, otherwise containerId, otherwise generate default name
        containerIdentifier = runtime.containerName || runtime.containerId ||
          (runtime.containerMode === "new" ? `choraleia-${activeWorkspace.name}` : undefined);
      }

      try {
        // Read file content from backend
        const content = await fsRead({
          assetId,
          containerId: containerIdentifier,
          path: filePath,
        });

        // Create editor pane with the loaded content
        const editor: EditorPane = {
          id: uuid(),
          kind: "editor",
          title: node.name,
          filePath: node.path,
          content,
          language: node.name.endsWith(".md") ? "markdown" : undefined,
          dirty: false,
        };

        mutateRoom(activeRoom?.id, (space) => ({
          ...space,
          panes: [...space.panes, editor],
          activePaneId: editor.id,
        }));
      } catch (err) {
        console.error("Failed to read file:", err);
        // Could show a toast/notification here
      }
    },
    [activeRoom?.id, activeWorkspace, mutateRoom],
  );

  const updateEditorContent = useCallback(
    (paneId: string, content: string) => {
      mutateRoom(activeRoom?.id, (space) => ({
        ...space,
        panes: space.panes.map((pane) =>
          pane.id === paneId && pane.kind === "editor"
            ? { ...pane, content, dirty: true }
            : pane,
        ),
      }));
    },
    [activeRoom?.id, mutateRoom],
  );

  const saveEditorContent = useCallback(
    async (paneId: string) => {
      if (!activeWorkspace) return;

      const { runtime } = activeWorkspace;

      // Find the pane to save
      const room = activeWorkspace.rooms.find(r => r.id === activeRoom?.id);
      const pane = room?.panes.find(
        (p): p is EditorPane => p.id === paneId && p.kind === "editor",
      );
      if (!pane) return;

      // Determine API params based on runtime type
      let assetId: string | undefined;
      let containerIdentifier: string | undefined;

      if (runtime.type === "docker-local" || runtime.type === "docker-remote") {
        assetId = runtime.dockerAssetId;
        // Use containerName if available, otherwise containerId, otherwise generate default name
        containerIdentifier = runtime.containerName || runtime.containerId ||
          (runtime.containerMode === "new" ? `choraleia-${activeWorkspace.name}` : undefined);
      }

      try {
        // Call backend API to save file
        await fsWrite({
          assetId,
          containerId: containerIdentifier,
          path: pane.filePath,
          content: pane.content,
        });

        // Update the room pane's dirty state
        mutateRoom(activeRoom?.id, (space) => ({
          ...space,
          panes: space.panes.map((p) =>
            p.id === paneId && p.kind === "editor"
              ? { ...p, dirty: false }
              : p,
          ),
        }));

        // Update workspace-level fileTree
        setWorkspaces((prev) =>
          prev.map((ws) =>
            ws.id === activeWorkspace.id
              ? { ...ws, fileTree: updateFileContent(ws.fileTree, pane.filePath, pane.content) }
              : ws
          )
        );
      } catch (err) {
        console.error("Failed to save file:", err);
        // Could show a toast/notification here
      }
    },
    [activeRoom?.id, activeWorkspace, mutateRoom],
  );

  const sendChatMessage = useCallback(
    (paneId: string, content: string) => {
      if (!content.trim()) return;
      mutateRoom(activeRoom?.id, (space) => ({
        ...space,
        panes: space.panes.map((pane) => {
          if (pane.id !== paneId || pane.kind !== "chat") return pane;
          const session = pane.sessions.find((s) => s.id === pane.activeSessionId);
          if (!session) return pane;
          const userMessage: ChatMessage = {
            id: uuid(),
            role: "user",
            content,
            timestamp: Date.now(),
          };
          const assistantMessage: ChatMessage = {
            id: uuid(),
            role: "assistant",
            content: `Captured in ${space.name}. I will sync workspace context in the background.`,
            timestamp: Date.now(),
          };
          const updatedSession: ChatSession = {
            ...session,
            updatedAt: Date.now(),
            messages: [...session.messages, userMessage, assistantMessage],
          };
          return {
            ...pane,
            sessions: pane.sessions.map((s) => (s.id === session.id ? updatedSession : s)),
          };
        }),
      }));
    },
    [activeRoom?.id, mutateRoom],
  );

  const setActiveChatSession = useCallback(
    (paneId: string, sessionId: string) => {
      mutateRoom(activeRoom?.id, (space) => ({
        ...space,
        panes: space.panes.map((pane) =>
          pane.id === paneId && pane.kind === "chat"
            ? { ...pane, activeSessionId: sessionId }
            : pane,
        ),
      }));
    },
    [activeRoom?.id, mutateRoom],
  );

  const createChatSession = useCallback(
    (paneId: string) => {
      mutateRoom(activeRoom?.id, (space) => ({
        ...space,
        panes: space.panes.map((pane) => {
          if (pane.id !== paneId || pane.kind !== "chat") return pane;
          const defaultTools = space.toolSessions.slice(0, 2);
          const newSession: ChatSession = {
            id: uuid(),
            title: `Session ${pane.sessions.length + 1}`,
            createdAt: Date.now(),
            updatedAt: Date.now(),
            messages: [],
            activeTools: defaultTools,
          };
          return {
            ...pane,
            sessions: [...pane.sessions, newSession],
            activeSessionId: newSession.id,
          };
        }),
      }));
    },
    [activeRoom?.id, mutateRoom],
  );

  const renameChatSession = useCallback(
    (paneId: string, sessionId: string, title: string) => {
      mutateRoom(activeRoom?.id, (space) => ({
        ...space,
        panes: space.panes.map((pane) => {
          if (pane.id !== paneId || pane.kind !== "chat") return pane;
          return {
            ...pane,
            sessions: pane.sessions.map((session) =>
              session.id === sessionId ? { ...session, title } : session,
            ),
          };
        }),
      }));
    },
    [activeRoom?.id, mutateRoom],
  );

  const deleteChatSession = useCallback(
    (paneId: string, sessionId: string) => {
      mutateRoom(activeRoom?.id, (space) => ({
        ...space,
        panes: space.panes.map((pane) => {
          if (pane.id !== paneId || pane.kind !== "chat") return pane;
          if (pane.sessions.length <= 1) return pane;
          const remainingSessions = pane.sessions.filter((session) => session.id !== sessionId);
          const nextActive =
            pane.activeSessionId === sessionId
              ? remainingSessions[0]?.id || pane.activeSessionId
              : pane.activeSessionId;
          return {
            ...pane,
            sessions: remainingSessions,
            activeSessionId: nextActive,
          };
        }),
      }));
    },
    [activeRoom?.id, mutateRoom],
  );

  const addFileNode = useCallback(
    async (parentPath: string | null, type: "file" | "folder", name: string) => {
      if (!name.trim() || !activeWorkspace) return;

      const { runtime } = activeWorkspace;
      const normalizedParent = parentPath || runtime.workDir.containerPath || runtime.workDir.path || "/";
      const basePath = normalizedParent === "/" ? "" : normalizedParent;
      const nodePath = `${basePath}/${name}`.replace(/\/+/g, "/");

      // Determine API params based on runtime type
      let assetId: string | undefined;
      let containerIdentifier: string | undefined;

      if (runtime.type === "docker-local" || runtime.type === "docker-remote") {
        assetId = runtime.dockerAssetId;
        // Use containerName if available, otherwise containerId, otherwise generate default name
        containerIdentifier = runtime.containerName || runtime.containerId ||
          (runtime.containerMode === "new" ? `choraleia-${activeWorkspace.name}` : undefined);
      }

      try {
        // Call backend API to create file or folder
        if (type === "folder") {
          await fsMkdir({ assetId, containerId: containerIdentifier, path: nodePath });
        } else {
          await fsTouch({ assetId, containerId: containerIdentifier, path: nodePath });
        }

        // Create local node for UI
        const newNode: FileNode = {
          id: uuid(),
          name,
          path: nodePath,
          type,
          children: type === "folder" ? [] : undefined,
        };

        // Update workspace-level fileTree
        setWorkspaces((prev) =>
          prev.map((ws) =>
            ws.id === activeWorkspace.id
              ? { ...ws, fileTree: appendNode(ws.fileTree, normalizedParent, newNode) }
              : ws
          )
        );
      } catch (err) {
        console.error(`Failed to create ${type}:`, err);
        // Could show a toast/notification here
      }
    },
    [activeWorkspace],
  );

  const deleteFileNode = useCallback(
    async (targetPath: string) => {
      if (!activeWorkspace) return;

      const { runtime } = activeWorkspace;

      // Determine API params based on runtime type
      let assetId: string | undefined;
      let containerIdentifier: string | undefined;

      if (runtime.type === "docker-local" || runtime.type === "docker-remote") {
        assetId = runtime.dockerAssetId;
        // Use containerName if available, otherwise containerId, otherwise generate default name
        containerIdentifier = runtime.containerName || runtime.containerId ||
          (runtime.containerMode === "new" ? `choraleia-${activeWorkspace.name}` : undefined);
      }

      try {
        // Call backend API to delete
        await fsRemove({ assetId, containerId: containerIdentifier, path: targetPath });

        // Close any editor panes that have this file open
        mutateRoom(activeRoom?.id, (space) => {
          const panesToKeep = space.panes.filter((pane) => {
            if (pane.kind !== "editor") return true;
            // If deleting a folder, close all files under it
            return !pane.filePath.startsWith(targetPath);
          });
          const needsNewActivePane = !panesToKeep.some((p) => p.id === space.activePaneId);
          const newActivePaneId = needsNewActivePane
            ? panesToKeep.find((p) => p.kind === "chat")?.id || panesToKeep[0]?.id || space.activePaneId
            : space.activePaneId;
          return {
            ...space,
            panes: panesToKeep,
            activePaneId: newActivePaneId,
          };
        });

        // Update workspace-level fileTree
        setWorkspaces((prev) =>
          prev.map((ws) =>
            ws.id === activeWorkspace.id
              ? { ...ws, fileTree: deleteNode(ws.fileTree, targetPath) }
              : ws
          )
        );
      } catch (err) {
        console.error("Failed to delete:", err);
      }
    },
    [activeRoom?.id, activeWorkspace, mutateRoom],
  );

  const renameFileNode = useCallback(
    async (targetPath: string, newName: string) => {
      if (!newName.trim() || !activeWorkspace) return;

      const { runtime } = activeWorkspace;
      const parentPath = targetPath.substring(0, targetPath.lastIndexOf("/")) || "";
      const newPath = `${parentPath}/${newName}`.replace(/\/+/g, "/");

      // Determine API params based on runtime type
      let assetId: string | undefined;
      let containerIdentifier: string | undefined;

      if (runtime.type === "docker-local" || runtime.type === "docker-remote") {
        assetId = runtime.dockerAssetId;
        // Use containerName if available, otherwise containerId, otherwise generate default name
        containerIdentifier = runtime.containerName || runtime.containerId ||
          (runtime.containerMode === "new" ? `choraleia-${activeWorkspace.name}` : undefined);
      }

      try {
        // Call backend API to rename
        await fsRename({ assetId, containerId: containerIdentifier, from: targetPath, to: newPath });

        // Update editor panes that have this file/folder open
        mutateRoom(activeRoom?.id, (space) => {
          const updatedPanes = space.panes.map((pane) => {
            if (pane.kind !== "editor") return pane;
            if (pane.filePath === targetPath) {
              // Direct match - update path and title
              return { ...pane, filePath: newPath, title: newName };
            }
            if (pane.filePath.startsWith(targetPath + "/")) {
              // File is inside renamed folder - update path prefix
              const newFilePath = pane.filePath.replace(targetPath, newPath);
              return { ...pane, filePath: newFilePath };
            }
            return pane;
          });
          return {
            ...space,
            panes: updatedPanes,
          };
        });

        // Update workspace-level fileTree
        setWorkspaces((prev) =>
          prev.map((ws) =>
            ws.id === activeWorkspace.id
              ? { ...ws, fileTree: renameNode(ws.fileTree, targetPath, newName) }
              : ws
          )
        );
      } catch (err) {
        console.error("Failed to rename:", err);
      }
    },
    [activeRoom?.id, activeWorkspace, mutateRoom],
  );

  const startToolPreview = useCallback(
    (toolId: string) => {
      mutateRoom(activeRoom?.id, (space) => {
        const session = space.toolSessions.find((tool) => tool.id === toolId);
        if (!session) return space;
        return {
          ...space,
          panes: space.panes.map((pane) => {
            if (pane.kind !== "chat") return pane;
            return {
              ...pane,
              sessions: pane.sessions.map((sessionItem) => {
                if (sessionItem.id !== pane.activeSessionId) return sessionItem;
                const alreadyActive = sessionItem.activeTools.some((tool) => tool.id === session.id);
                if (alreadyActive) return sessionItem;
                return {
                  ...sessionItem,
                  activeTools: [...sessionItem.activeTools, session],
                };
              }),
            };
          }),
        };
      });
    },
    [activeRoom?.id, mutateRoom],
  );

  const openTerminalTab = useCallback(() => {
    mutateRoom(activeRoom?.id, (space) => {
      // Count existing terminals to generate unique name
      const terminalCount = space.panes.filter(
        (pane): pane is ToolPane =>
          pane.kind === "tool" && pane.title.startsWith("Terminal"),
      ).length;

      const terminalId = uuid();
      const terminalLabel = terminalCount === 0 ? "Terminal" : `Terminal ${terminalCount + 1}`;

      // Create new terminal session
      const terminalSession: ToolSession = {
        id: terminalId,
        label: terminalLabel,
        type: "terminal",
        status: "running",
        summary: "Interactive terminal session",
      };

      // Create new terminal pane
      const toolPane: ToolPane = {
        id: uuid(),
        kind: "tool",
        title: terminalLabel,
        toolId: terminalId,
        summary: terminalSession.summary,
      };

      return {
        ...space,
        toolSessions: [...space.toolSessions, terminalSession],
        panes: [...space.panes, toolPane],
        activePaneId: toolPane.id,
      };
    });
  }, [activeRoom?.id, mutateRoom]);

  const setWorkMode = useCallback((mode: WorkMode) => {
    mutateActiveWorkspace((workspace) => ({
      ...workspace,
      workMode: mode,
    }));
  }, [mutateActiveWorkspace]);

  // Chat mode: open a new terminal in preview panel
  const openChatTerminal = useCallback(() => {
    mutateRoom(activeRoom?.id, (space) => {
      const terminalCount = space.chatPanes.filter(
        (pane): pane is ToolPane =>
          pane.kind === "tool" && pane.title.startsWith("Terminal"),
      ).length;

      const terminalId = uuid();
      const terminalLabel = terminalCount === 0 ? "Terminal" : `Terminal ${terminalCount + 1}`;

      const terminalSession: ToolSession = {
        id: terminalId,
        label: terminalLabel,
        type: "terminal",
        status: "running",
        summary: "Interactive terminal session",
      };

      const toolPane: ToolPane = {
        id: uuid(),
        kind: "tool",
        title: terminalLabel,
        toolId: terminalId,
        summary: terminalSession.summary,
      };

      return {
        ...space,
        toolSessions: [...space.toolSessions, terminalSession],
        chatPanes: [...space.chatPanes, toolPane],
        activeChatPaneId: toolPane.id,
      };
    });
  }, [activeRoom?.id, mutateRoom]);

  // Chat mode: set active preview pane
  const setChatActivePane = useCallback((paneId: string) => {
    mutateRoom(activeRoom?.id, (space) => ({
      ...space,
      activeChatPaneId: paneId,
    }));
  }, [activeRoom?.id, mutateRoom]);

  // Chat mode: close a preview pane
  const closeChatPane = useCallback((paneId: string) => {
    mutateRoom(activeRoom?.id, (space) => {
      const newPanes = space.chatPanes.filter((p) => p.id !== paneId);
      let newActiveId = space.activeChatPaneId;
      if (space.activeChatPaneId === paneId) {
        newActiveId = newPanes[0]?.id || "";
      }
      return {
        ...space,
        chatPanes: newPanes,
        activeChatPaneId: newActiveId,
      };
    });
  }, [activeRoom?.id, mutateRoom]);

  return (
    <WorkspaceContext.Provider
      value={{
        workspaces,
        activeWorkspaceId,
        activeWorkspace,
        activeRoom,
        fileTree,
        fileTreeLoading,
        refreshFileTree,
        selectWorkspace,
        createWorkspace: createWorkspaceHandler,
        createWorkspaceWithConfig,
        renameWorkspace,
        deleteWorkspace,
        updateWorkspaceConfig,
        startWorkspace,
        stopWorkspace,
        selectRoom,
        createRoom: createRoomHandler,
        renameRoom: renameRoomHandler,
        deleteRoom: deleteRoomHandler,
        duplicateRoom: duplicateRoomHandler,
        setActivePane,
        closePane,
        openFileFromTree,
        updateEditorContent,
        saveEditorContent,
        sendChatMessage,
        setActiveChatSession,
        createChatSession,
        renameChatSession,
        deleteChatSession,
        addFileNode,
        deleteFileNode,
        renameFileNode,
        startToolPreview,
        openTerminalTab,
        setWorkMode,
        openChatTerminal,
        setChatActivePane,
        closeChatPane,
      }}
    >
      {children}
    </WorkspaceContext.Provider>
  );
};

export const useWorkspaces = () => {
  const context = useContext(WorkspaceContext);
  if (!context) throw new Error("useWorkspaces must be used within WorkspaceProvider");
  return context;
};
