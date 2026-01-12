import React, { useCallback } from "react";
import { Box, Typography } from "@mui/material";
import { TabBar } from "./TabBar";
import { TabItem, SplitDirection, Pane } from "../../../state/workspaces";

interface TabContentRendererProps {
  tab: TabItem;
  isActive: boolean;
  workspaceId: string;
  workspaceName: string;
  runtimeType: string;
  dockerAssetId?: string;
  containerName?: string;
  containerId?: string;
  containerMode?: string;
  onEditorChange?: (content: string) => void;
  onEditorSave?: () => void;
}

// This will be passed from parent to render actual content
export type TabContentRenderer = React.FC<TabContentRendererProps>;

interface PaneContainerProps {
  pane: Pane;
  isActive: boolean;
  workspaceId: string;
  workspaceName: string;
  runtimeType: string;
  dockerAssetId?: string;
  containerName?: string;
  containerId?: string;
  containerMode?: string;
  conversationId?: string;
  onTabChange: (paneId: string, tabId: string) => void;
  onCloseTab: (paneId: string, tabId: string) => void;
  onSplitPane: (paneId: string, tabId: string, direction: SplitDirection) => void;
  onPaneFocus: (paneId: string) => void;
  onAddTerminal?: (paneId: string) => void;
  onEditorChange?: (paneId: string, tabId: string, content: string) => void;
  onEditorSave?: (paneId: string, tabId: string) => void;
  renderTabContent: TabContentRenderer;
}

export const PaneContainer: React.FC<PaneContainerProps> = ({
  pane,
  isActive,
  workspaceId,
  workspaceName,
  runtimeType,
  dockerAssetId,
  containerName,
  containerId,
  containerMode,
  conversationId: _conversationId,
  onTabChange,
  onCloseTab,
  onSplitPane,
  onPaneFocus,
  onAddTerminal,
  onEditorChange,
  onEditorSave,
  renderTabContent: RenderTabContent,
}) => {
  const tabs = pane.tabs || [];
  const activeTabId = pane.activeTabId || tabs[0]?.id || "";
  const activeTab = tabs.find((t) => t.id === activeTabId);

  const handleTabChange = useCallback((tabId: string) => {
    onTabChange(pane.id, tabId);
  }, [pane.id, onTabChange]);

  const handleCloseTab = useCallback((tabId: string) => {
    onCloseTab(pane.id, tabId);
  }, [pane.id, onCloseTab]);

  const handleSplitPane = useCallback((tabId: string, direction: SplitDirection) => {
    onSplitPane(pane.id, tabId, direction);
  }, [pane.id, onSplitPane]);

  const handleFocus = useCallback(() => {
    onPaneFocus(pane.id);
  }, [pane.id, onPaneFocus]);

  const handleAddTerminal = useCallback(() => {
    onAddTerminal?.(pane.id);
  }, [pane.id, onAddTerminal]);

  const handleEditorChange = useCallback((content: string) => {
    if (activeTab) {
      onEditorChange?.(pane.id, activeTab.id, content);
    }
  }, [pane.id, activeTab, onEditorChange]);

  const handleEditorSave = useCallback(() => {
    if (activeTab) {
      onEditorSave?.(pane.id, activeTab.id);
    }
  }, [pane.id, activeTab, onEditorSave]);

  return (
    <Box
      display="flex"
      flexDirection="column"
      height="100%"
      width="100%"
      onClick={handleFocus}
      sx={{
        minWidth: 0,
        overflow: "hidden",
      }}
    >
      {/* Tab bar */}
      <TabBar
        tabs={tabs}
        activeTabId={activeTabId}
        isActivePane={isActive}
        onTabChange={handleTabChange}
        onCloseTab={handleCloseTab}
        onSplitPane={handleSplitPane}
        onAddTerminal={onAddTerminal ? handleAddTerminal : undefined}
      />

      {/* Tab content */}
      <Box flex={1} display="flex" flexDirection="column" minHeight={0} minWidth={0} overflow="hidden">
        {tabs.length === 0 ? (
          <Box
            display="flex"
            alignItems="center"
            justifyContent="center"
            height="100%"
            color="text.secondary"
          >
            <Typography variant="body2">
              No tabs open. Click + to add a terminal.
            </Typography>
          </Box>
        ) : (
          tabs.map((tab) => (
            <Box
              key={tab.id}
              flex={1}
              display={tab.id === activeTabId ? "flex" : "none"}
              flexDirection="column"
              minHeight={0}
              minWidth={0}
              overflow="hidden"
            >
              <RenderTabContent
                tab={tab}
                isActive={tab.id === activeTabId && isActive}
                workspaceId={workspaceId}
                workspaceName={workspaceName}
                runtimeType={runtimeType}
                dockerAssetId={dockerAssetId}
                containerName={containerName}
                containerId={containerId}
                containerMode={containerMode}
                onEditorChange={tab.type === "editor" ? handleEditorChange : undefined}
                onEditorSave={tab.type === "editor" ? handleEditorSave : undefined}
              />
            </Box>
          ))
        )}
      </Box>
    </Box>
  );
};

