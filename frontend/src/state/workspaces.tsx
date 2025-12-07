import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { v4 as uuid } from "uuid";

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

export type WorkDirectory = {
  id: string;
  kind: "local" | "docker";
  path: string;
  container?: string;
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

export type SpaceAssetsConfig = {
  hosts: HostAssetConfig[];
  k8s: K8sAssetConfig[];
};

export type ToolConfig = {
  id: string;
  name: string;
  type: string;
  description?: string;
};

export type SpaceConfigInput = {
  name: string;
  description?: string;
  workDirectories: WorkDirectory[];
  assets: SpaceAssetsConfig;
  tools: ToolConfig[];
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

export type Space = {
  id: string;
  name: string;
  description?: string;
  environment: "Local" | "Remote";
  location: "Local" | "Remote" | "Docker" | "Pod";
  fileTree: FileNode[];
  panes: SpacePane[];
  activePaneId: string;
  toolSessions: ToolSession[];
};

export type Workspace = {
  id: string;
  name: string;
  description?: string;
  status: "running" | "idle" | "sleeping";
  color: string;
  location: "Local" | "Remote";
  workDirectories: WorkDirectory[];
  assets: SpaceAssetsConfig;
  tools: ToolConfig[];
  spaces: Space[];
  activeSpaceId: string;
};

export interface WorkspaceContextValue {
  workspaces: Workspace[];
  activeWorkspaceId?: string;
  activeWorkspace?: Workspace;
  activeSpace?: Space;
  selectWorkspace: (id: string) => void;
  createWorkspace: () => void;
  renameWorkspace: (workspaceId: string, name: string) => void;
  createWorkspaceWithConfig: (config: SpaceConfigInput) => void;
  updateWorkspaceConfig: (workspaceId: string, config: SpaceConfigInput) => void;
  selectSpace: (spaceId: string) => void;
  createSpace: () => void;
  setActivePane: (paneId: string) => void;
  closePane: (paneId: string) => void;
  openFileFromTree: (filePath: string) => void;
  updateEditorContent: (paneId: string, content: string) => void;
  saveEditorContent: (paneId: string) => void;
  sendChatMessage: (paneId: string, content: string) => void;
  setActiveChatSession: (paneId: string, sessionId: string) => void;
  createChatSession: (paneId: string) => void;
  renameChatSession: (paneId: string, sessionId: string, title: string) => void;
  deleteChatSession: (paneId: string, sessionId: string) => void;
  addFileNode: (
    parentPath: string | null,
    nodeType: "file" | "folder",
    name: string,
  ) => void;
  startToolPreview: (toolId: string) => void;
  openTerminalTab: () => void;
}

const STORAGE_KEY = "omniterm.workspaces.v1";
const ACTIVE_KEY = `${STORAGE_KEY}.active`;

const WorkspaceContext = createContext<WorkspaceContextValue | undefined>(
  undefined,
);

const palette = ["#4f46e5", "#0ea5e9", "#10b981", "#f97316"];

const seedFileTree = (): FileNode[] => [
  {
    id: uuid(),
    name: "services",
    path: "/services",
    type: "folder",
    children: [
      {
        id: uuid(),
        name: "orchestrator",
        path: "/services/orchestrator",
        type: "folder",
        children: [
          {
            id: uuid(),
            name: "README.md",
            path: "/services/orchestrator/README.md",
            type: "file",
            content:
              "# Orchestrator\nCoordinates terminals, AI tools, and file updates inside the space.\n",
          },
          {
            id: uuid(),
            name: "main.go",
            path: "/services/orchestrator/main.go",
            type: "file",
            content:
              "package main\n\nfunc main() {\n    // TODO: bootstrap orchestrator workflow\n}\n",
          },
        ],
      },
      {
        id: uuid(),
        name: "dash",
        path: "/services/dash",
        type: "folder",
        children: [
          {
            id: uuid(),
            name: "index.tsx",
            path: "/services/dash/index.tsx",
            type: "file",
            content:
              "export const Dashboard = () => {\n  return <div>Space runtime dashboard</div>;\n};\n",
          },
        ],
      },
    ],
  },
  {
    id: uuid(),
    name: "playbooks",
    path: "/playbooks",
    type: "folder",
    children: [
      {
        id: uuid(),
        name: "bootstrap.md",
        path: "/playbooks/bootstrap.md",
        type: "file",
        content:
          "## Bootstrap Checklist\n- Verify credentials\n- Warm up AI chat\n- Run smoke terminal command\n",
      },
    ],
  },
];

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

const createSpace = (name: string): Space => {
  const toolSessions = seedToolSessions();
  const chatPane = seedChat(toolSessions);
  const editorPane = seedEditor();
  return {
    id: uuid(),
    name,
    description: "Local space scoped to ops files",
    environment: "Local",
    location: "Local",
    fileTree: seedFileTree(),
    panes: [chatPane, editorPane],
    activePaneId: chatPane.id,
    toolSessions,
  };
};

const createWorkspace = (name: string, colorIndex: number): Workspace => {
  const firstSpace = createSpace(`${name} Space`);
  const template = createSpaceConfigTemplate(name);
  return {
    id: uuid(),
    name,
    status: "running",
    color: palette[colorIndex % palette.length],
    location: "Local",
    workDirectories: template.workDirectories,
    assets: template.assets,
    tools: template.tools,
    spaces: [firstSpace],
    activeSpaceId: firstSpace.id,
  };
};

const seedWorkspaces = (): Workspace[] => [createWorkspace("Ops & Research", 0)];

export const createSpaceConfigTemplate = (name = "New Space"): SpaceConfigInput => ({
  name,
  description: "",
  workDirectories: [
    { id: uuid(), kind: "local", path: "~/projects" },
  ],
  assets: {
    hosts: [],
    k8s: [],
  },
  tools: [],
});

const ensureChatPane = (pane: any): ChatPane => {
  if (pane.sessions && pane.activeSessionId) return pane as ChatPane;
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
        activeTools: [],
      },
    ],
    activeSessionId: sessionId,
  };
};

const normalizeWorkspace = (workspace: Workspace): Workspace => ({
  ...workspace,
  description: workspace.description || "",
  workDirectories: workspace.workDirectories || createSpaceConfigTemplate(workspace.name).workDirectories,
  assets: workspace.assets || { hosts: [], k8s: [] },
  tools: workspace.tools || [],
  spaces: workspace.spaces.map((space) => ({
    ...space,
    panes: space.panes.map((pane) =>
      pane.kind === "chat"
        ? ensureChatPane(pane)
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

export const WorkspaceProvider: React.FC<React.PropsWithChildren> = ({
  children,
}) => {
  const [workspaces, setWorkspaces] = useState<Workspace[]>(() => {
    if (typeof window === "undefined") return seedWorkspaces();
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (stored)
        return (JSON.parse(stored) as Workspace[]).map(normalizeWorkspace);
    } catch (err) {
      console.warn("Failed to read workspaces", err);
    }
    return seedWorkspaces();
  });

  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string>(() => {
    if (typeof window === "undefined") return seedWorkspaces()[0].id;
    try {
      const stored = window.localStorage.getItem(ACTIVE_KEY);
      if (stored) return stored;
    } catch (err) {
      console.warn("Failed to read active workspace", err);
    }
    return seedWorkspaces()[0].id;
  });

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(workspaces));
  }, [workspaces]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(ACTIVE_KEY, activeWorkspaceId);
  }, [activeWorkspaceId]);

  const activeWorkspace = useMemo(
    () => workspaces.find((ws) => ws.id === activeWorkspaceId),
    [workspaces, activeWorkspaceId],
  );

  const activeSpace = useMemo(() => {
    if (!activeWorkspace) return undefined;
    return activeWorkspace.spaces.find(
      (space) => space.id === activeWorkspace.activeSpaceId,
    );
  }, [activeWorkspace]);

  const mutateActiveWorkspace = useCallback(
    (mutator: (workspace: Workspace) => Workspace) => {
      if (!activeWorkspaceId) return;
      setWorkspaces((prev) =>
        prev.map((ws) => (ws.id === activeWorkspaceId ? mutator(ws) : ws)),
      );
    },
    [activeWorkspaceId],
  );

  const mutateSpace = useCallback(
    (spaceId: string | undefined, mutator: (space: Space) => Space) => {
      if (!spaceId) return;
      mutateActiveWorkspace((workspace) => ({
        ...workspace,
        spaces: workspace.spaces.map((space) =>
          space.id === spaceId ? mutator(space) : space,
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
    (config: SpaceConfigInput) => {
      setWorkspaces((prev) => {
        const newSpace = createSpace(`${config.name} Space`);
        const workspace: Workspace = {
          id: uuid(),
          name: config.name,
          description: config.description,
          status: "running",
          color: palette[prev.length % palette.length],
          location: "Local",
          workDirectories: config.workDirectories,
          assets: config.assets,
          tools: config.tools,
          spaces: [newSpace],
          activeSpaceId: newSpace.id,
        };
        setActiveWorkspaceId(workspace.id);
        return [...prev, workspace];
      });
    },
    [],
  );

  const createWorkspaceHandler = useCallback(() => {
    const nextIndex = workspaces.length + 1;
    createWorkspaceWithConfig(createSpaceConfigTemplate(`Workspace ${nextIndex}`));
  }, [createWorkspaceWithConfig, workspaces.length]);

  const updateWorkspaceConfig = useCallback(
    (workspaceId: string, config: SpaceConfigInput) => {
      setWorkspaces((prev) =>
        prev.map((workspace) =>
          workspace.id === workspaceId
            ? {
                ...workspace,
                name: config.name,
                description: config.description,
                workDirectories: config.workDirectories,
                assets: config.assets,
                tools: config.tools,
              }
            : workspace,
        ),
      );
    },
    [],
  );

  const renameWorkspace = useCallback(
    (workspaceId: string, name: string) => {
      setWorkspaces((prev) =>
        prev.map((ws) => (ws.id === workspaceId ? { ...ws, name } : ws)),
      );
    },
    [],
  );

  const selectSpace = useCallback(
    (spaceId: string) => {
      mutateActiveWorkspace((workspace) => {
        if (!workspace.spaces.some((s) => s.id === spaceId)) return workspace;
        return { ...workspace, activeSpaceId: spaceId };
      });
    },
    [mutateActiveWorkspace],
  );

  const createSpaceHandler = useCallback(() => {
    mutateActiveWorkspace((workspace) => {
      const nextSpace = createSpace(`Space ${workspace.spaces.length + 1}`);
      return {
        ...workspace,
        spaces: [...workspace.spaces, nextSpace],
        activeSpaceId: nextSpace.id,
      };
    });
  }, [mutateActiveWorkspace]);

  const setActivePane = useCallback(
    (paneId: string) => {
      mutateSpace(activeSpace?.id, (space) => ({
        ...space,
        activePaneId: paneId,
      }));
    },
    [activeSpace?.id, mutateSpace],
  );

  const closePane = useCallback(
    (paneId: string) => {
      mutateSpace(activeSpace?.id, (space) => {
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
    [activeSpace?.id, mutateSpace],
  );

  const openFileFromTree = useCallback(
    (filePath: string) => {
      mutateSpace(activeSpace?.id, (space) => {
        const existing = space.panes.find(
          (pane) => pane.kind === "editor" && pane.filePath === filePath,
        );
        if (existing)
          return {
            ...space,
            activePaneId: existing.id,
          };
        const node = findFileNode(space.fileTree, filePath);
        if (!node || node.type !== "file") return space;
        const editor: EditorPane = {
          id: uuid(),
          kind: "editor",
          title: node.name,
          filePath: node.path,
          content: node.content || "",
          language: node.name.endsWith(".md") ? "markdown" : undefined,
          dirty: false,
        };
        return {
          ...space,
          panes: [...space.panes, editor],
          activePaneId: editor.id,
        };
      });
    },
    [activeSpace?.id, mutateSpace],
  );

  const updateEditorContent = useCallback(
    (paneId: string, content: string) => {
      mutateSpace(activeSpace?.id, (space) => ({
        ...space,
        panes: space.panes.map((pane) =>
          pane.id === paneId && pane.kind === "editor"
            ? { ...pane, content, dirty: true }
            : pane,
        ),
      }));
    },
    [activeSpace?.id, mutateSpace],
  );

  const saveEditorContent = useCallback(
    (paneId: string) => {
      mutateSpace(activeSpace?.id, (space) => {
        const pane = space.panes.find(
          (p): p is EditorPane => p.id === paneId && p.kind === "editor",
        );
        if (!pane) return space;
        return {
          ...space,
          panes: space.panes.map((p) =>
            p.id === paneId && p.kind === "editor"
              ? { ...p, dirty: false }
              : p,
          ),
          fileTree: updateFileContent(space.fileTree, pane.filePath, pane.content),
        };
      });
    },
    [activeSpace?.id, mutateSpace],
  );

  const sendChatMessage = useCallback(
    (paneId: string, content: string) => {
      if (!content.trim()) return;
      mutateSpace(activeSpace?.id, (space) => ({
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
    [activeSpace?.id, mutateSpace],
  );

  const setActiveChatSession = useCallback(
    (paneId: string, sessionId: string) => {
      mutateSpace(activeSpace?.id, (space) => ({
        ...space,
        panes: space.panes.map((pane) =>
          pane.id === paneId && pane.kind === "chat"
            ? { ...pane, activeSessionId: sessionId }
            : pane,
        ),
      }));
    },
    [activeSpace?.id, mutateSpace],
  );

  const createChatSession = useCallback(
    (paneId: string) => {
      mutateSpace(activeSpace?.id, (space) => ({
        ...space,
        panes: space.panes.map((pane) => {
          if (pane.id !== paneId || pane.kind !== "chat") return pane;
          const newSession: ChatSession = {
            id: uuid(),
            title: `Session ${pane.sessions.length + 1}`,
            createdAt: Date.now(),
            updatedAt: Date.now(),
            messages: [],
            activeTools: [],
          };
          return {
            ...pane,
            sessions: [...pane.sessions, newSession],
            activeSessionId: newSession.id,
          };
        }),
      }));
    },
    [activeSpace?.id, mutateSpace],
  );

  const renameChatSession = useCallback(
    (paneId: string, sessionId: string, title: string) => {
      mutateSpace(activeSpace?.id, (space) => ({
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
    [activeSpace?.id, mutateSpace],
  );

  const deleteChatSession = useCallback(
    (paneId: string, sessionId: string) => {
      mutateSpace(activeSpace?.id, (space) => ({
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
    [activeSpace?.id, mutateSpace],
  );

  const addFileNode = useCallback(
    (parentPath: string | null, type: "file" | "folder", name: string) => {
      if (!name.trim()) return;
      mutateSpace(activeSpace?.id, (space) => {
        const normalizedParent = parentPath || null;
        const parentPrefix = normalizedParent && normalizedParent !== "/"
          ? normalizedParent
          : normalizedParent === "/"
            ? ""
            : "";
        const nodePath = `${parentPrefix}/${name}`.replace(/\/+/g, "/");
        const newNode: FileNode = {
          id: uuid(),
          name,
          path: nodePath,
          type,
          children: type === "folder" ? [] : undefined,
          content:
            type === "file"
              ? `// ${name}\n// created ${new Date().toLocaleString()}\n`
              : undefined,
        };
        return {
          ...space,
          fileTree: appendNode(space.fileTree, normalizedParent, newNode),
        };
      });
    },
    [activeSpace?.id, mutateSpace],
  );

  const startToolPreview = useCallback(
    (toolId: string) => {
      mutateSpace(activeSpace?.id, (space) => {
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
    [activeSpace?.id, mutateSpace],
  );

  const openTerminalTab = useCallback(() => {
    mutateSpace(activeSpace?.id, (space) => {
      let terminalSession = space.toolSessions.find(
        (session) => session.type === "terminal",
      );
      let nextSpace = space;
      if (!terminalSession) {
        terminalSession = {
          id: uuid(),
          label: "Terminal",
          type: "terminal",
          status: "running",
          summary: "Interactive terminal session",
        };
        nextSpace = {
          ...space,
          toolSessions: [...space.toolSessions, terminalSession],
        };
      }
      const existingPane = nextSpace.panes.find(
        (pane): pane is ToolPane =>
          pane.kind === "tool" && pane.toolId === terminalSession!.id,
      );
      if (existingPane) {
        return { ...nextSpace, activePaneId: existingPane.id };
      }
      const toolPane: ToolPane = {
        id: uuid(),
        kind: "tool",
        title: terminalSession!.label,
        toolId: terminalSession!.id,
        summary: terminalSession!.summary,
      };
      return {
        ...nextSpace,
        panes: [...nextSpace.panes, toolPane],
        activePaneId: toolPane.id,
      };
    });
  }, [activeSpace?.id, mutateSpace]);

  return (
    <WorkspaceContext.Provider
      value={{
        workspaces,
        activeWorkspaceId,
        activeWorkspace,
        activeSpace,
        selectWorkspace,
        createWorkspace: createWorkspaceHandler,
        createWorkspaceWithConfig,
        renameWorkspace,
        updateWorkspaceConfig,
        selectSpace,
        createSpace: createSpaceHandler,
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
        startToolPreview,
        openTerminalTab,
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
