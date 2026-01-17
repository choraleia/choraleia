import React, { useCallback, useState, useMemo, useEffect, useRef } from "react";
import {
  Box,
  IconButton,
  Typography,
  Tooltip,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import RoomTopBar from "./SpaceTopBar";
import SpaceConfigDialog from "./SpaceConfigDialog";
import RoomManagerDialog from "./RoomManagerDialog";
import WorkspaceChat from "./WorkspaceChat";
import WorkspaceExplorer from "./WorkspaceExplorer";
import { PaneTreeRenderer, TabContent } from "./pane";
import {
  useWorkspaces,
  SpaceConfigInput,
  TabItem,
  SplitDirection,
  isLeafPane,
  Pane,
  findTabInTree,
} from "../../state/workspaces";
import { listBrowsers, BrowserInstance } from "../../api/browser";
import { v4 as uuid } from "uuid";

interface SpaceLayoutProps {
  onBackToOverview?: () => void;
}

const SpaceLayout: React.FC<SpaceLayoutProps> = ({ onBackToOverview }) => {
  const {
    activeWorkspace,
    activeRoom,
    updateWorkspaceConfig,
    // Pane tree operations
    addTabToPaneTree,
    closeTabFromPaneTree,
    setActiveTabInPaneTree,
    setActivePaneInPaneTree,
    splitPaneInTree,
    resizePanesInTree,
    updateTabInPaneTree,
    saveTabInPaneTree,
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

  // Browser instances for pane tree
  const [browsers, setBrowsers] = useState<BrowserInstance[]>([]);

  // Track which browsers we've already added to avoid infinite loop
  const addedBrowserIdsRef = useRef<Set<string>>(new Set());

  // Fetch browsers for this conversation
  useEffect(() => {
    if (!currentConversationId) {
      setBrowsers([]);
      addedBrowserIdsRef.current.clear();
      return;
    }
    const fetchBrowsers = async () => {
      try {
        const result = await listBrowsers(currentConversationId);
        setBrowsers(result || []);
      } catch (error) {
        console.error("Failed to fetch browsers:", error);
      }
    };
    fetchBrowsers();
    const interval = setInterval(fetchBrowsers, 5000);
    return () => clearInterval(interval);
  }, [currentConversationId]);

  // Add browser tabs to pane tree when new browsers appear
  useEffect(() => {
    if (!activeRoom || browsers.length === 0) return;

    // Helper function to check if browser tab already exists in paneTree
    const browserTabExists = (browserId: string, pane: Pane): boolean => {
      if (isLeafPane(pane) && pane.tabs) {
        return pane.tabs.some(tab => tab.type === "browser" && tab.browserId === browserId);
      }
      if (pane.children) {
        return pane.children.some(child => browserTabExists(browserId, child));
      }
      return false;
    };

    // Add new browsers as tabs (only if not already in paneTree and status is not closed/error)
    browsers.forEach(browser => {
      // Skip closed or errored browsers - don't add them as new tabs
      if (browser.status === "closed" || browser.status === "error") {
        return;
      }
      // Check both ref and paneTree to avoid duplicates
      if (!addedBrowserIdsRef.current.has(browser.id) && !browserTabExists(browser.id, activeRoom.paneTree)) {
        addedBrowserIdsRef.current.add(browser.id);
        const browserTab: TabItem = {
          id: `browser-${browser.id}`,
          type: "browser",
          title: browser.current_title || (browser.current_url ? new URL(browser.current_url).hostname : "Browser"),
          browserId: browser.id,
          url: browser.current_url,
        };
        addTabToPaneTree(browserTab);
      } else {
        // Mark as added if it exists in paneTree but not in ref (e.g., after page refresh)
        addedBrowserIdsRef.current.add(browser.id);
      }
    });
  }, [browsers, activeRoom, addTabToPaneTree]);

  // Close browser tabs when browser is closed or has error
  useEffect(() => {
    if (!activeRoom) return;

    // Find all browser tabs in pane tree
    const findBrowserTabs = (pane: Pane): { paneId: string; tabId: string; browserId: string }[] => {
      const results: { paneId: string; tabId: string; browserId: string }[] = [];
      if (isLeafPane(pane) && pane.tabs) {
        pane.tabs.forEach(tab => {
          if (tab.type === "browser" && tab.browserId) {
            results.push({ paneId: pane.id, tabId: tab.id, browserId: tab.browserId });
          }
        });
      }
      if (pane.children) {
        pane.children.forEach(child => {
          results.push(...findBrowserTabs(child));
        });
      }
      return results;
    };

    const browserTabs = findBrowserTabs(activeRoom.paneTree);

    browserTabs.forEach(({ paneId, tabId, browserId }) => {
      const browser = browsers.find(b => b.id === browserId);
      // Close tab if browser is closed, has error, or no longer exists in the list
      if (!browser || browser.status === "closed" || browser.status === "error") {
        // Remove from tracking ref
        addedBrowserIdsRef.current.delete(browserId);
        // Close the tab
        closeTabFromPaneTree(paneId, tabId);
      }
    });
  }, [browsers, activeRoom, closeTabFromPaneTree]);

  // Update browser tab titles with page title
  useEffect(() => {
    if (!activeRoom) return;

    browsers.forEach(browser => {
      if (browser.status === "closed" || browser.status === "error") return;

      const tabId = `browser-${browser.id}`;
      const tabResult = findTabInTree(activeRoom.paneTree, tabId);

      if (tabResult) {
        // Determine the new title - prefer page title, fallback to hostname
        const newTitle = browser.current_title ||
          (browser.current_url ? (() => {
            try {
              return new URL(browser.current_url).hostname;
            } catch {
              return "Browser";
            }
          })() : "Browser");

        // Only update if title changed
        if (tabResult.tab.title !== newTitle) {
          updateTabInPaneTree(tabResult.pane.id, tabId, { title: newTitle });
        }
      }
    });
  }, [browsers, activeRoom, updateTabInPaneTree]);

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
      agents: activeWorkspace.agents || [],
    };
  }, [activeWorkspace]);

  // Pane tree event handlers
  const handleTabChange = useCallback((paneId: string, tabId: string) => {
    setActiveTabInPaneTree(paneId, tabId);
  }, [setActiveTabInPaneTree]);

  const handleCloseTab = useCallback((paneId: string, tabId: string) => {
    closeTabFromPaneTree(paneId, tabId);
  }, [closeTabFromPaneTree]);

  const handleSplitPane = useCallback((paneId: string, tabId: string, direction: SplitDirection) => {
    splitPaneInTree(paneId, tabId, direction);
  }, [splitPaneInTree]);

  const handlePaneFocus = useCallback((paneId: string) => {
    setActivePaneInPaneTree(paneId);
  }, [setActivePaneInPaneTree]);

  const handleResizePanes = useCallback((paneId: string, sizes: number[]) => {
    resizePanesInTree(paneId, sizes);
  }, [resizePanesInTree]);

  const handleAddTerminal = useCallback((targetPaneId?: string) => {
    // Count existing terminals in pane tree
    let terminalCount = 0;
    const countTerminals = (pane: Pane | undefined) => {
      if (!pane) return;
      if (isLeafPane(pane) && pane.tabs) {
        terminalCount += pane.tabs.filter(t => t.type === "terminal").length;
      }
      if (pane.children) {
        pane.children.forEach(countTerminals);
      }
    };
    countTerminals(activeRoom?.paneTree);

    const terminalLabel = terminalCount === 0 ? "Terminal" : `Terminal ${terminalCount + 1}`;
    const terminalTab: TabItem = {
      id: uuid(),
      type: "terminal",
      title: terminalLabel,
      terminalKey: `workspace-terminal-${activeWorkspace?.id}-${uuid()}`,
    };

    addTabToPaneTree(terminalTab, targetPaneId);
  }, [activeRoom?.paneTree, activeWorkspace?.id, addTabToPaneTree]);

  const handleEditorChange = useCallback((paneId: string, tabId: string, content: string) => {
    updateTabInPaneTree(paneId, tabId, { content, dirty: true });
  }, [updateTabInPaneTree]);

  const handleEditorSave = useCallback((paneId: string, tabId: string) => {
    saveTabInPaneTree(paneId, tabId);
  }, [saveTabInPaneTree]);

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

  // Render tab content using TabContent component
  const renderTabContent = useCallback((props: React.ComponentProps<typeof TabContent>) => {
    return <TabContent {...props} conversationId={currentConversationId} />;
  }, [currentConversationId]);

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
      <Box display="flex" flex={1} minHeight={0} minWidth={0} width="100%" overflow="hidden">
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

        {/* Work Area - Pane Tree */}
        {activeWorkspace && activeRoom && (
          <Box flex={1} display="flex" flexDirection="column" minHeight={0} minWidth={0} overflow="hidden">
            {/* Add terminal button when no tabs */}
            {isLeafPane(activeRoom.paneTree) && (!activeRoom.paneTree.tabs || activeRoom.paneTree.tabs.length === 0) ? (
              <Box display="flex" flexDirection="column" alignItems="center" justifyContent="center" height="100%" gap={2}>
                <Typography variant="body2" color="text.secondary">
                  No tabs open
                </Typography>
                <Tooltip title="New Terminal">
                  <IconButton onClick={() => handleAddTerminal()} color="primary">
                    <AddIcon />
                  </IconButton>
                </Tooltip>
              </Box>
            ) : (
              <PaneTreeRenderer
                pane={activeRoom.paneTree}
                activePaneId={activeRoom.activePaneTreePaneId}
                workspaceId={activeWorkspace.id}
                workspaceName={activeWorkspace.name}
                runtimeType={activeWorkspace.runtime.type}
                dockerAssetId={activeWorkspace.runtime.dockerAssetId}
                containerName={activeWorkspace.runtime.containerName}
                containerId={activeWorkspace.runtime.containerId}
                containerMode={activeWorkspace.runtime.containerMode}
                conversationId={currentConversationId}
                onTabChange={handleTabChange}
                onCloseTab={handleCloseTab}
                onSplitPane={handleSplitPane}
                onPaneFocus={handlePaneFocus}
                onResizePanes={handleResizePanes}
                onAddTerminal={handleAddTerminal}
                onEditorChange={handleEditorChange}
                onEditorSave={handleEditorSave}
                renderTabContent={renderTabContent}
              />
            )}
          </Box>
        )}
      </Box>

      {dialogInitialConfig && (
        <SpaceConfigDialog
          open={isConfigOpen}
          onClose={closeConfig}
          initialConfig={dialogInitialConfig}
          onSave={handleSaveConfig}
          workspaceId={activeWorkspace?.id}
        />
      )}
      <RoomManagerDialog open={isRoomManagerOpen} onClose={closeRoomManager} />
    </Box>
  );
};

export default SpaceLayout;
