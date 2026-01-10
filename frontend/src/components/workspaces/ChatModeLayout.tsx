import React, { useCallback, useState, useEffect } from "react";
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
import { useWorkspaces, EditorPane } from "../../state/workspaces";
import TerminalComponent from "../assets/Terminal";
import Editor from "@monaco-editor/react";
import WorkspaceChat from "./WorkspaceChat";
import BrowserPreview from "./BrowserPreview";
import { listBrowsers, BrowserInstance } from "../../api/browser";

// Preview tab item interface
interface PreviewTab {
  id: string;
  type: "terminal" | "editor" | "browser";
  title: string;
  modified?: boolean;
  // For terminal
  terminalKey?: string;
  // For editor
  filePath?: string;
  content?: string;
}

const ChatModeLayout: React.FC = () => {
  const { activeWorkspace, activeRoom, openChatTerminal, closeChatPane, setChatActivePane, updateEditorContent } = useWorkspaces();

  // Track current conversation ID for browser preview
  const [currentConversationId, setCurrentConversationId] = useState<string>("");

  // Get preview tabs from chatPanes (terminals and editors) - chat mode specific
  const previewTabs: PreviewTab[] = React.useMemo(() => {
    if (!activeRoom) return [];

    const tabs: PreviewTab[] = [];

    activeRoom.chatPanes.forEach((pane) => {
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

  // Use activeChatPaneId from room
  const activePreviewTabId = activeRoom?.activeChatPaneId || previewTabs[0]?.id || null;

  const activeTab = previewTabs.find((t) => t.id === activePreviewTabId);

  const handleTabChange = useCallback(
    (_: React.SyntheticEvent, value: string) => {
      setChatActivePane(value);
    },
    [setChatActivePane]
  );

  const handleAddTerminal = useCallback(() => {
    openChatTerminal();
  }, [openChatTerminal]);

  const handleCloseTab = useCallback((tabId: string, event: React.MouseEvent) => {
    event.stopPropagation();
    closeChatPane(tabId);
  }, [closeChatPane]);

  const getTabIcon = (type: PreviewTab["type"]) => {
    switch (type) {
      case "terminal":
        return <TerminalIcon fontSize="small" />;
      case "editor":
        return <DescriptionIcon fontSize="small" />;
      case "browser":
        return <WebIcon fontSize="small" />;
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

  return (
    <Box display="flex" flex={1} minHeight={0} width="100%">
      {/* Full width: WorkspaceChat with Preview as right panel */}
      {activeWorkspace && (
        <WorkspaceChat
          workspaceId={activeWorkspace.id}
          onConversationChange={setCurrentConversationId}
          previewComponent={
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
          }
        />
      )}
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
  updateEditorContent: (id: string, content: string) => void;
  conversationId: string;
}

const PreviewPanel: React.FC<PreviewPanelProps> = ({
  previewTabs,
  activePreviewTabId,
  activeTab,
  activeWorkspace,
  onTabChange,
  onAddTerminal,
  onCloseTab,
  getTabIcon,
  getLanguage,
  updateEditorContent,
  conversationId,
}) => {
  // Track active browsers for this conversation
  const [browsers, setBrowsers] = useState<BrowserInstance[]>([]);

  // Poll for browsers when conversation changes
  useEffect(() => {
    if (!conversationId) {
      setBrowsers([]);
      return;
    }

    // Initial fetch
    listBrowsers(conversationId)
      .then((data) => setBrowsers(data || []))
      .catch(() => setBrowsers([]));

    // Poll every 3 seconds for browser changes
    const interval = setInterval(() => {
      listBrowsers(conversationId)
        .then((data) => setBrowsers(data || []))
        .catch(() => {});
    }, 3000);

    return () => clearInterval(interval);
  }, [conversationId]);

  // Check if we have active browsers (not closed)
  const hasActiveBrowsers = browsers.some(b => b.status !== "closed");

  return (
    <Box display="flex" flexDirection="column" height="100%" minWidth={0}>
      {/* Preview Tabs */}
      <Box
        display="flex"
        alignItems="center"
        borderBottom={(theme) => `1px solid ${theme.palette.divider}`}
        px={1}
        minHeight={36}
      >
        <Tabs
          value={activePreviewTabId || false}
          onChange={onTabChange}
          variant="scrollable"
          scrollButtons="auto"
          sx={{
            minHeight: 36,
            flex: 1,
            "& .MuiTab-root": {
              minHeight: 36,
              textTransform: "none",
              fontSize: 13,
              py: 0,
              px: 1.5,
            },
          }}
        >
          {previewTabs.map((tab) => (
            <Tab
              key={tab.id}
              value={tab.id}
              label={
                <Box display="flex" alignItems="center" gap={0.5}>
                  {getTabIcon(tab.type)}
                  <Typography variant="body2" noWrap sx={{ maxWidth: 120 }}>
                    {tab.title}
                  </Typography>
                  {tab.modified && (
                    <CircleIcon sx={{ fontSize: 8, color: "primary.main" }} />
                  )}
                  <IconButton
                    size="small"
                    sx={{ p: 0.25, ml: 0.5 }}
                    onClick={(e) => onCloseTab(tab.id, e)}
                  >
                    <CloseIcon sx={{ fontSize: 14 }} />
                  </IconButton>
                </Box>
              }
            />
          ))}
        </Tabs>
        <Tooltip title="New Terminal">
          <IconButton size="small" onClick={onAddTerminal}>
            <AddIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </Box>

      {/* Preview Content */}
      <Box flex={1} display="flex" flexDirection="column" minHeight={0} position="relative">
        {previewTabs.length === 0 && !hasActiveBrowsers ? (
          <Box
            flex={1}
            display="flex"
            alignItems="center"
            justifyContent="center"
            flexDirection="column"
            gap={2}
          >
            <Typography variant="body1" color="text.secondary">
              No preview tabs open
            </Typography>
            <Typography variant="body2" color="text.secondary">
              AI will open terminals, files, and browsers here as needed
            </Typography>
          </Box>
        ) : (
          <Box flex={1} display="flex" flexDirection="column" minHeight={0}>
            {/* Browser Preview - shows at top when browsers are active */}
            {hasActiveBrowsers && conversationId && (
              <Box
                sx={{
                  flex: previewTabs.length === 0 ? 1 : "0 0 auto",
                  maxHeight: previewTabs.length > 0 ? "50%" : "100%",
                  minHeight: 200,
                  borderBottom: previewTabs.length > 0 ? 1 : 0,
                  borderColor: "divider",
                  overflow: "hidden",
                }}
              >
                <BrowserPreview conversationId={conversationId} />
              </Box>
            )}

            {/* Terminals and editors */}
            {previewTabs.length > 0 && (
              <Box flex={1} display="flex" flexDirection="column" minHeight={0}>
                {/* Render all terminal tabs but hide inactive ones */}
                {previewTabs
                  .filter((tab) => tab.type === "terminal")
                  .map((tab) => (
                    <Box
                      key={tab.id}
                      flex={1}
                      display={activePreviewTabId === tab.id ? "flex" : "none"}
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
                          isActive={activePreviewTabId === tab.id}
                        />
                      )}
                    </Box>
                  ))}

                {/* Render active editor tab */}
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
                        automaticLayout: true,
                      }}
                    />
                  </Box>
                )}
              </Box>
            )}
          </Box>
        )}
      </Box>
    </Box>
  );
};

export default ChatModeLayout;

