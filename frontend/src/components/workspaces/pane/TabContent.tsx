import React, { useRef, useCallback } from "react";
import { Box } from "@mui/material";
import { TabItem } from "../../../state/workspaces";
import TerminalComponent from "../../assets/Terminal";
import { Editor } from "../../editor";
import BrowserPreview from "../BrowserPreview";

interface TabContentProps {
  tab: TabItem;
  isActive: boolean;
  workspaceId: string;
  workspaceName: string;
  runtimeType: string;
  dockerAssetId?: string;
  containerName?: string;
  containerId?: string;
  containerMode?: string;
  conversationId?: string;
  onEditorChange?: (content: string) => void;
  onEditorSave?: () => void;
}

export const TabContent: React.FC<TabContentProps> = ({
  tab,
  isActive,
  workspaceId,
  workspaceName,
  runtimeType,
  dockerAssetId,
  containerName,
  containerId,
  containerMode,
  conversationId,
  onEditorChange,
  onEditorSave,
}) => {
  // Track the last content we sent to parent to avoid infinite loops
  const lastContentRef = useRef<string>(tab.content || "");

  // Update ref when tab.content changes from outside (e.g., file load)
  if (tab.content !== undefined && tab.content !== lastContentRef.current) {
    // Only update if it's a significant external change (not from our own onChange)
    lastContentRef.current = tab.content;
  }

  const handleEditorChange = useCallback((value: string) => {
    // Only propagate if content actually changed
    if (value !== lastContentRef.current) {
      lastContentRef.current = value;
      onEditorChange?.(value);
    }
  }, [onEditorChange]);

  // Terminal tab
  if (tab.type === "terminal") {
    const terminalKey = tab.terminalKey || `workspace-terminal-${workspaceId}-${tab.id}`;
    const assetId = runtimeType === "local" ? "local" : dockerAssetId || "local";
    const containerIdentifier = runtimeType !== "local"
      ? (containerName || containerId || (containerMode === "new" ? `choraleia-${workspaceName}` : undefined))
      : undefined;

    return (
      <Box flex={1} display="flex" flexDirection="column" minHeight={0}>
        <TerminalComponent
          hostInfo={{ ip: "localhost", port: 0, name: tab.title }}
          tabKey={terminalKey}
          assetId={assetId}
          containerId={containerIdentifier}
          isActive={isActive}
        />
      </Box>
    );
  }

  // Editor tab
  if (tab.type === "editor") {
    return (
      <Box
        sx={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          minWidth: 0,
          minHeight: 0,
          overflow: "hidden",
          position: "relative",
        }}
      >
        <Editor
          filePath={tab.filePath}
          value={tab.content || ""}
          onChange={handleEditorChange}
          onSave={() => onEditorSave?.()}
        />
      </Box>
    );
  }

  // Browser tab
  if (tab.type === "browser") {
    return (
      <BrowserPreview
        conversationId={conversationId || ""}
        browserId={tab.browserId}
      />
    );
  }

  return null;
};

