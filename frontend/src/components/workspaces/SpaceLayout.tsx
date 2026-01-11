import React, { useCallback, useState, useMemo, useEffect } from "react";
import {
  Box,
  IconButton,
  Tabs,
  Tab,
  Typography,
  Tooltip,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import CloseIcon from "@mui/icons-material/Close";
import TerminalIcon from "@mui/icons-material/Terminal";
import DescriptionIcon from "@mui/icons-material/Description";
import WebIcon from "@mui/icons-material/Web";
import CircleIcon from "@mui/icons-material/Circle";
import RoomTopBar from "./SpaceTopBar";
import SpaceConfigDialog from "./SpaceConfigDialog";
import RoomManagerDialog from "./RoomManagerDialog";
import WorkspaceChat from "./WorkspaceChat";
import WorkspaceExplorer from "./WorkspaceExplorer";
import BrowserPreview from "./BrowserPreview";
import TerminalComponent from "../assets/Terminal";
import Editor from "@monaco-editor/react";
import { useWorkspaces, SpaceConfigInput, EditorPane } from "../../state/workspaces";
import { listBrowsers, BrowserInstance } from "../../api/browser";

// Preview tab item interface
interface PreviewTab {
  id: string;
  type: "terminal" | "editor" | "browser";
  title: string;
  modified?: boolean;
  terminalKey?: string;
  filePath?: string;
  content?: string;
}

interface SpaceLayoutProps {
  onBackToOverview?: () => void;
}

const SpaceLayout: React.FC<SpaceLayoutProps> = ({ onBackToOverview }) => {
  const {
    activeWorkspace,
    activeRoom,
    updateWorkspaceConfig,
    openWorkTerminal,
    closeWorkPane,
    setWorkActivePane,
    updateEditorContent,
  } = useWorkspaces();

  // Dialog states
  const [isConfigOpen, setConfigOpen] = useState(false);
  const [isRoomManagerOpen, setRoomManagerOpen] = useState(false);

  // Panel visibility state
  const [showExplorer, setShowExplorer] = useState(true);
  const [showChat, setShowChat] = useState(true);

  // Explorer resizer state
  const [explorerWidth, setExplorerWidth] = useState(240);

  // Chat resizer state
  const [chatWidth, setChatWidth] = useState(450);

  // Track current conversation ID for browser preview
  const [currentConversationId, setCurrentConversationId] = useState<string>("");

  const closeConfig = useCallback(() => setConfigOpen(false), []);
  const openRoomManager = useCallback(() => setRoomManagerOpen(true), []);
  const closeRoomManager = useCallback(() => setRoomManagerOpen(false), []);

  const handleSaveConfig = useCallback(
    (config: SpaceConfigInput) => {
      if (activeWorkspace) {
        updateWorkspaceConfig(activeWorkspace.id, config);
      }
      closeConfig();
    },
    [activeWorkspace, updateWorkspaceConfig, closeConfig],
  );

  const dialogInitialConfig = useMemo(() => {
    if (!activeWorkspace) return null;
    return {
      name: activeWorkspace.name,
      description: activeWorkspace.description,
      runtime: activeWorkspace.runtime,
      assets: activeWorkspace.assets,
      tools: activeWorkspace.tools,
    };
  }, [activeWorkspace]);

  // Get preview tabs from workPanes
  const previewTabs: PreviewTab[] = useMemo(() => {
    if (!activeRoom) return [];
    const tabs: PreviewTab[] = [];
    activeRoom.workPanes.forEach((pane) => {
      if (pane.kind === "tool" && pane.title.startsWith("Terminal")) {
        tabs.push({
          id: pane.id,
          type: "terminal",
          title: pane.title,
          terminalKey: `workspace-chat-terminal-${activeWorkspace?.id}-${pane.id}`,
        });
      } else if (pane.kind === "editor") {
        const editorPane = pane as EditorPane;
        tabs.push({
          id: pane.id,
          type: "editor",
          title: editorPane.filePath.split("/").pop() || "Untitled",
          filePath: editorPane.filePath,
          content: editorPane.content,
          modified: editorPane.dirty,
        });
      }
    });
    return tabs;
  }, [activeRoom, activeWorkspace?.id]);

  const activePreviewTabId = activeRoom?.activeWorkPaneId || previewTabs[0]?.id || null;
  const activeTab = previewTabs.find((t) => t.id === activePreviewTabId);

  const handleTabChange = useCallback(
    (_: React.SyntheticEvent, value: string) => {
      setWorkActivePane(value);
    },
    [setWorkActivePane]
  );

  const handleAddTerminal = useCallback(() => {
    openWorkTerminal();
  }, [openWorkTerminal]);

  const handleCloseTab = useCallback((tabId: string, event: React.MouseEvent) => {
    event.stopPropagation();
    closeWorkPane(tabId);
  }, [closeWorkPane]);

  const getTabIcon = (type: PreviewTab["type"]) => {
    switch (type) {
      case "terminal": return <TerminalIcon fontSize="small" />;
      case "editor": return <DescriptionIcon fontSize="small" />;
      case "browser": return <WebIcon fontSize="small" />;
    }
  };

  const getLanguage = (filePath?: string) => {
    if (!filePath) return undefined;
    if (filePath.endsWith(".md")) return "markdown";
    if (filePath.endsWith(".ts") || filePath.endsWith(".tsx")) return "typescript";
    if (filePath.endsWith(".js") || filePath.endsWith(".jsx")) return "javascript";
    if (filePath.endsWith(".json")) return "json";
    if (filePath.endsWith(".py")) return "python";
    if (filePath.endsWith(".go")) return "go";
    if (filePath.endsWith(".yaml") || filePath.endsWith(".yml")) return "yaml";
    if (filePath.endsWith(".sh")) return "shell";
    if (filePath.endsWith(".css")) return "css";
    if (filePath.endsWith(".html")) return "html";
    return undefined;
  };

  // Explorer resize handler
  const handleExplorerResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = explorerWidth;
    const onMouseMove = (moveEvent: MouseEvent) => {
      const delta = moveEvent.clientX - startX;
      const newWidth = Math.max(150, Math.min(400, startWidth + delta));
      setExplorerWidth(newWidth);
    };
    const onMouseUp = () => {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }, [explorerWidth]);

  // Chat resize handler
  const handleChatResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = chatWidth;
    const onMouseMove = (moveEvent: MouseEvent) => {
      const delta = moveEvent.clientX - startX;
      const newWidth = Math.max(300, Math.min(800, startWidth + delta));
      setChatWidth(newWidth);
    };
    const onMouseUp = () => {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }, [chatWidth]);

  return (
    <Box display="flex" flexDirection="column" height="100%">
      {/* Top Bar */}
      <Box
        display="flex"
        alignItems="center"
        px={1}
        py={0.5}
        borderBottom={(theme) => `1px solid ${theme.palette.divider}`}
        gap={2}
      >
        <Box display="flex" alignItems="center" gap={1} flexShrink={0}>
          <RoomTopBar onOpenManager={openRoomManager} onBackToOverview={onBackToOverview} section="left" />
        </Box>
        <Box display="flex" alignItems="center" justifyContent="center" flex={1} gap={0.5} overflow="hidden">
          <RoomTopBar onOpenManager={openRoomManager} onBackToOverview={onBackToOverview} section="center" />
        </Box>
        <Box display="flex" alignItems="center" gap={0.5} flexShrink={0}>
          <RoomTopBar onOpenManager={openRoomManager} onBackToOverview={onBackToOverview} section="right" />
          <Box display="flex" alignItems="center" gap={0.5}>
            <Box
              onClick={() => setShowExplorer(!showExplorer)}
              sx={{
                px: 1, py: 0.25, cursor: "pointer", fontSize: 12,
                fontWeight: showExplorer ? 600 : 400,
                bgcolor: showExplorer ? "action.selected" : "transparent",
                color: "text.primary", borderRadius: 1, userSelect: "none",
                "&:hover": { bgcolor: "action.hover" },
              }}
            >
              Explorer
            </Box>
            <Box
              onClick={() => setShowChat(!showChat)}
              sx={{
                px: 1, py: 0.25, cursor: "pointer", fontSize: 12,
                fontWeight: showChat ? 600 : 400,
                bgcolor: showChat ? "action.selected" : "transparent",
                color: "text.primary", borderRadius: 1, userSelect: "none",
                "&:hover": { bgcolor: "action.hover" },
              }}
            >
              Chat
            </Box>
          </Box>
        </Box>
      </Box>

      {/* Content Area */}
      <Box display="flex" flex={1} minHeight={0} width="100%">
        {/* Explorer Panel */}
        {showExplorer && (
          <>
            <Box
              sx={{
                width: explorerWidth, minWidth: explorerWidth, maxWidth: explorerWidth,
                flexShrink: 0, display: "flex", flexDirection: "column", overflow: "hidden",
                borderRight: "1px solid", borderColor: "divider",
              }}
            >
              <WorkspaceExplorer />
            </Box>
            <Box
              onMouseDown={handleExplorerResize}
              sx={{
                width: 4, cursor: "col-resize", flexShrink: 0,
                "&:hover": { bgcolor: "primary.main", opacity: 0.3 },
              }}
            />
          </>
        )}

        {/* Chat Area */}
        {showChat && activeWorkspace && (
          <>
            <Box
              sx={{
                width: chatWidth, minWidth: chatWidth, maxWidth: chatWidth,
                flexShrink: 0, display: "flex", flexDirection: "column", overflow: "hidden",
                borderRight: "1px solid", borderColor: "divider",
              }}
            >
              <WorkspaceChat
                workspaceId={activeWorkspace.id}
                onConversationChange={setCurrentConversationId}
              />
            </Box>
            <Box
              onMouseDown={handleChatResize}
              sx={{
                width: 4, cursor: "col-resize", flexShrink: 0,
                "&:hover": { bgcolor: "primary.main", opacity: 0.3 },
              }}
            />
          </>
        )}

        {/* Preview Panel (Work Area) */}
        {activeWorkspace && (
          <Box flex={1} display="flex" flexDirection="column" minHeight={0}>
            <PreviewPanel
              previewTabs={previewTabs}
              activePreviewTabId={activePreviewTabId}
              activeTab={activeTab}
              activeWorkspace={activeWorkspace}
              onTabChange={handleTabChange}
              onAddTerminal={handleAddTerminal}
              onCloseTab={handleCloseTab}
              getTabIcon={getTabIcon}
              getLanguage={getLanguage}
              updateEditorContent={updateEditorContent}
              conversationId={currentConversationId}
            />
          </Box>
        )}
      </Box>

      {dialogInitialConfig && (
        <SpaceConfigDialog open={isConfigOpen} onClose={closeConfig} initialConfig={dialogInitialConfig} onSave={handleSaveConfig} />
      )}
      <RoomManagerDialog open={isRoomManagerOpen} onClose={closeRoomManager} />
    </Box>
  );
};

// Preview Panel Component
interface PreviewPanelProps {
  previewTabs: PreviewTab[];
  activePreviewTabId: string | null;
  activeTab: PreviewTab | undefined;
  activeWorkspace: any;
  onTabChange: (event: React.SyntheticEvent, value: string) => void;
  onAddTerminal: () => void;
  onCloseTab: (tabId: string, event: React.MouseEvent) => void;
  getTabIcon: (type: PreviewTab["type"]) => React.ReactNode;
  getLanguage: (filePath?: string) => string | undefined;
  updateEditorContent: (paneId: string, content: string) => void;
  conversationId: string;
}

const PreviewPanel: React.FC<PreviewPanelProps> = ({
  previewTabs, activePreviewTabId, activeTab, activeWorkspace,
  onTabChange, onAddTerminal, onCloseTab, getTabIcon, getLanguage,
  updateEditorContent, conversationId,
}) => {
  const [browsers, setBrowsers] = useState<BrowserInstance[]>([]);

  // Fetch browsers for this conversation
  useEffect(() => {
    if (!conversationId) { setBrowsers([]); return; }
    const fetchBrowsers = async () => {
      try {
        const result = await listBrowsers(conversationId);
        setBrowsers(result || []);
      } catch (error) {
        console.error("Failed to fetch browsers:", error);
      }
    };
    fetchBrowsers();
    const interval = setInterval(fetchBrowsers, 5000);
    return () => clearInterval(interval);
  }, [conversationId]);

  // Build all tabs including browser tabs
  const allTabs = useMemo(() => {
    const tabs: PreviewTab[] = [...previewTabs];
    browsers.forEach((browser) => {
      tabs.push({
        id: `browser-${browser.id}`,
        type: "browser",
        title: browser.current_url ? new URL(browser.current_url).hostname : "Browser",
      });
    });
    return tabs;
  }, [previewTabs, browsers]);

  // Use activePreviewTabId directly, fallback to first tab if not found
  const effectiveActiveTabId = allTabs.some(t => t.id === activePreviewTabId)
    ? activePreviewTabId
    : allTabs[0]?.id || null;
  const effectiveActiveTab = allTabs.find((t) => t.id === effectiveActiveTabId);

  // Handle tab change - just call onTabChange for all tabs
  const handleTabChangeInternal = (event: React.SyntheticEvent, value: string) => {
    onTabChange(event, value);
  };

  return (
    <Box display="flex" flexDirection="column" height="100%">
      {/* Tab bar */}
      <Box
        display="flex"
        alignItems="center"
        sx={{ borderBottom: "1px solid", borderColor: "divider", height: 36, minHeight: 36, bgcolor: "background.paper" }}
      >
        <Tabs
          value={effectiveActiveTabId || false}
          onChange={handleTabChangeInternal}
          variant="scrollable"
          scrollButtons="auto"
          sx={{
            minHeight: 36, flex: 1,
            "& .MuiTab-root": { minHeight: 36, py: 0, px: 1.5, textTransform: "none", fontSize: 12 },
          }}
        >
          {allTabs.map((tab) => (
            <Tab
              key={tab.id}
              value={tab.id}
              label={
                <Box display="flex" alignItems="center" gap={0.5}>
                  {getTabIcon(tab.type)}
                  <span>{tab.title}</span>
                  {tab.modified && <CircleIcon sx={{ fontSize: 8, color: "warning.main" }} />}
                  {!tab.id.startsWith("browser-") && (
                    <CloseIcon sx={{ fontSize: 14, ml: 0.5, opacity: 0.6 }} onClick={(e) => onCloseTab(tab.id, e)} />
                  )}
                </Box>
              }
            />
          ))}
        </Tabs>
        <Tooltip title="New Terminal">
          <IconButton size="small" onClick={onAddTerminal} sx={{ mr: 1 }}>
            <AddIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </Box>

      {/* Tab content */}
      <Box flex={1} display="flex" flexDirection="column" minHeight={0}>
        {allTabs.length === 0 ? (
          <Box display="flex" alignItems="center" justifyContent="center" height="100%" color="text.secondary">
            <Typography variant="body2">No tabs open. Click + to add a terminal.</Typography>
          </Box>
        ) : (
          <>
            {allTabs.filter((tab) => tab.type === "terminal").map((tab) => (
              <Box
                key={tab.id}
                flex={1}
                display={effectiveActiveTabId === tab.id ? "flex" : "none"}
                flexDirection="column"
                minHeight={0}
              >
                <TerminalComponent
                  hostInfo={{ ip: "localhost", port: 0, name: tab.title }}
                  tabKey={tab.terminalKey!}
                  assetId={activeWorkspace.runtime.type === "local" ? "local" : activeWorkspace.runtime.dockerAssetId || "local"}
                  containerId={
                    activeWorkspace.runtime.type !== "local"
                      ? (activeWorkspace.runtime.containerName || activeWorkspace.runtime.containerId ||
                         (activeWorkspace.runtime.containerMode === "new" ? `choraleia-${activeWorkspace.name}` : undefined))
                      : undefined
                  }
                  isActive={effectiveActiveTabId === tab.id}
                />
              </Box>
            ))}
            {effectiveActiveTab?.type === "editor" && (
              <Editor
                height="100%"
                defaultLanguage={getLanguage(effectiveActiveTab.filePath)}
                value={effectiveActiveTab.content || ""}
                onChange={(value) => { if (effectiveActiveTab && value !== undefined) updateEditorContent(effectiveActiveTab.id, value); }}
                options={{ minimap: { enabled: false }, fontSize: 13, lineNumbers: "on", wordWrap: "on", automaticLayout: true }}
              />
            )}
            {effectiveActiveTab?.type === "browser" && (
              <BrowserPreview
                conversationId={conversationId}
                browserId={effectiveActiveTabId?.startsWith("browser-") ? effectiveActiveTabId.replace("browser-", "") : undefined}
              />
            )}
          </>
        )}
      </Box>
    </Box>
  );
};

export default SpaceLayout;
