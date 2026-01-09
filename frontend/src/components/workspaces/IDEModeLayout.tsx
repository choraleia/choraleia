import React, { useCallback, useState } from "react";
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
import CircleIcon from "@mui/icons-material/Circle";
import ChatIcon from "@mui/icons-material/Chat";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import { useWorkspaces, EditorPane } from "../../state/workspaces";
import TerminalComponent from "../assets/Terminal";
import Editor from "@monaco-editor/react";
import ChatPanel from "./ChatPanel";

interface WorkTab {
  id: string;
  type: "terminal" | "editor";
  title: string;
  modified?: boolean;
  // For terminal
  terminalKey?: string;
  // For editor
  filePath?: string;
  content?: string;
}

const IDEModeLayout: React.FC = () => {
  const {
    activeWorkspace,
    activeRoom,
    openTerminalTab,
    closePane,
    setActivePane,
    updateEditorContent,
    saveEditorContent,
  } = useWorkspaces();

  // Chat panel collapsed state
  const [chatCollapsed, setChatCollapsed] = useState(true);
  const chatWidth = 380;

  // Build tabs from panes
  const tabs: WorkTab[] = React.useMemo(() => {
    if (!activeRoom) return [];

    const result: WorkTab[] = [];

    activeRoom.panes.forEach((pane) => {
      if (pane.kind === "tool" && pane.title.startsWith("Terminal")) {
        result.push({
          id: pane.id,
          type: "terminal",
          title: pane.title,
          terminalKey: `workspace-terminal-${activeWorkspace?.id}-${pane.id}`,
        });
      } else if (pane.kind === "editor") {
        const editorPane = pane as EditorPane;
        result.push({
          id: pane.id,
          type: "editor",
          title: editorPane.filePath.split("/").pop() || "Untitled",
          filePath: editorPane.filePath,
          content: editorPane.content,
          modified: editorPane.dirty,
        });
      }
    });

    return result;
  }, [activeRoom, activeWorkspace?.id]);

  const activeTabId = activeRoom?.activePaneId;
  const activeTab = tabs.find((t) => t.id === activeTabId);

  const handleTabChange = useCallback(
    (_: React.SyntheticEvent, value: string) => {
      setActivePane(value);
    },
    [setActivePane]
  );

  const handleCloseTab = useCallback(
    (tabId: string, event: React.MouseEvent) => {
      event.stopPropagation();
      closePane(tabId);
    },
    [closePane]
  );

  const handleAddTerminal = useCallback(() => {
    openTerminalTab();
  }, [openTerminalTab]);

  const handleSaveFile = useCallback(
    (tabId: string) => {
      saveEditorContent(tabId);
    },
    [saveEditorContent]
  );

  // Handle Ctrl+S for save
  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "s") {
        e.preventDefault();
        if (activeTab?.type === "editor" && activeTab.id) {
          handleSaveFile(activeTab.id);
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [activeTab, handleSaveFile]);

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

  return (
    <Box display="flex" flex={1} minHeight={0} overflow="hidden">
      {/* Main Editor/Terminal Area */}
      <Box display="flex" flexDirection="column" flex={1} minHeight={0} minWidth={0} overflow="hidden">
        {/* Tab Bar */}
        <Box
          display="flex"
          alignItems="center"
          borderBottom={(theme) => `1px solid ${theme.palette.divider}`}
          minHeight={36}
        >
          {tabs.length > 0 ? (
            <Tabs
              value={activeTabId || false}
              onChange={handleTabChange}
              variant="scrollable"
              scrollButtons="auto"
              sx={{
                flex: 1,
                minHeight: 36,
                "& .MuiTab-root": {
                  minHeight: 36,
                  textTransform: "none",
                  fontSize: 13,
                  py: 0,
                  px: 1.5,
                },
                "& .MuiTabs-indicator": {
                  height: 2,
                },
              }}
            >
              {tabs.map((tab) => (
                <Tab
                  key={tab.id}
                  value={tab.id}
                  label={
                    <Box display="flex" alignItems="center" gap={0.5}>
                      {tab.type === "terminal" ? (
                        <TerminalIcon sx={{ fontSize: 16 }} />
                      ) : (
                        <DescriptionIcon sx={{ fontSize: 16 }} />
                      )}
                      <Typography variant="body2" noWrap sx={{ maxWidth: 150 }}>
                        {tab.title}
                      </Typography>
                      {tab.modified && (
                        <CircleIcon sx={{ fontSize: 8, color: "primary.main" }} />
                      )}
                      <IconButton
                        size="small"
                        sx={{ p: 0.25, ml: 0.5 }}
                        onClick={(e) => handleCloseTab(tab.id, e)}
                      >
                        <CloseIcon sx={{ fontSize: 14 }} />
                      </IconButton>
                    </Box>
                  }
                />
              ))}
            </Tabs>
          ) : (
            <Box flex={1} />
          )}
          <Tooltip title="New Terminal">
            <IconButton size="small" sx={{ mx: 0.5 }} onClick={handleAddTerminal}>
              <AddIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        </Box>

        {/* Content Area */}
        <Box flex={1} display="flex" flexDirection="column" minHeight={0} minWidth={0} overflow="hidden">
          {tabs.length === 0 ? (
            <Box
              flex={1}
              display="flex"
              alignItems="center"
              justifyContent="center"
              flexDirection="column"
              gap={2}
            >
              <Typography variant="h6" color="text.secondary">
                No files or terminals open
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Double-click a file in the explorer or click + to open a terminal
              </Typography>
            </Box>
          ) : (
            <>
              {/* Keep all terminals mounted */}
              {tabs
                .filter((tab) => tab.type === "terminal")
                .map((tab) => (
                  <Box
                    key={tab.id}
                    flex={1}
                    display={activeTabId === tab.id ? "flex" : "none"}
                    flexDirection="column"
                    minHeight={0}
                  >
                    {activeWorkspace && (
                      <TerminalComponent
                        hostInfo={{ ip: "localhost", port: 0, name: tab.title }}
                        tabKey={tab.terminalKey!}
                        assetId={
                          activeWorkspace.runtime.type === "local"
                            ? "local"
                            : activeWorkspace.runtime.dockerAssetId || "local"
                        }
                        containerId={
                          activeWorkspace.runtime.type !== "local"
                            ? (activeWorkspace.runtime.containerName ||
                               activeWorkspace.runtime.containerId ||
                               (activeWorkspace.runtime.containerMode === "new" ? `choraleia-${activeWorkspace.name}` : undefined))
                            : undefined
                        }
                        isActive={activeTabId === tab.id}
                      />
                    )}
                  </Box>
                ))}

              {/* Render active editor */}
              {activeTab?.type === "editor" && (
                <Box flex={1} display="flex" flexDirection="column" minHeight={0}>
                  <Editor
                    height="100%"
                    language={getLanguage(activeTab.filePath)}
                    value={activeTab.content}
                    onChange={(value) => updateEditorContent(activeTab.id, value ?? "")}
                    options={{
                      minimap: { enabled: false },
                      fontSize: 13,
                      scrollBeyondLastLine: false,
                      wordWrap: "on",
                      lineNumbers: "on",
                      renderLineHighlight: "line",
                      automaticLayout: true,
                    }}
                  />
                </Box>
              )}
            </>
          )}
        </Box>
      </Box>

      {/* Chat Toggle Button (when collapsed) */}
      {chatCollapsed && (
        <Box
          display="flex"
          flexDirection="column"
          alignItems="center"
          py={1}
          borderLeft={(theme) => `1px solid ${theme.palette.divider}`}
          flexShrink={0}
        >
          <Tooltip title="Open AI Chat" placement="left">
            <IconButton
              size="small"
              onClick={() => setChatCollapsed(false)}
              sx={{
                borderRadius: 1,
                "&:hover": { bgcolor: "action.hover" },
              }}
            >
              <ChatIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        </Box>
      )}

      {/* Chat Panel (when expanded) */}
      {!chatCollapsed && (
        <Box
          width={chatWidth}
          flexShrink={0}
          display="flex"
          flexDirection="column"
          minHeight={0}
          borderLeft={(theme) => `1px solid ${theme.palette.divider}`}
        >
          {/* Chat Header with collapse button */}
          <Box
            display="flex"
            alignItems="center"
            px={1}
            minHeight={36}
            borderBottom={(theme) => `1px solid ${theme.palette.divider}`}
          >
            <Tooltip title="Collapse Chat">
              <IconButton size="small" onClick={() => setChatCollapsed(true)}>
                <ChevronRightIcon fontSize="small" />
              </IconButton>
            </Tooltip>
            <Typography variant="subtitle2" sx={{ ml: 0.5 }}>
              AI Assistant
            </Typography>
          </Box>
          <Box flex={1} minHeight={0} overflow="hidden">
            <ChatPanel compact />
          </Box>
        </Box>
      )}
    </Box>
  );
};

export default IDEModeLayout;


