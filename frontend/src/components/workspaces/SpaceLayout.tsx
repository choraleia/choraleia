import React, { useCallback, useState, useMemo } from "react";
import { Box } from "@mui/material";
import RoomTopBar from "./SpaceTopBar";
import SpaceTabs from "./SpaceTabs";
import SpaceCanvas from "./SpaceCanvas";
import RightInspector from "./RightInspector";
import SpaceConfigDialog from "./SpaceConfigDialog";
import RoomManagerDialog from "./RoomManagerDialog";
import { useWorkspaces, SpaceConfigInput } from "../../state/workspaces";

interface SpaceLayoutProps {
  onBackToOverview?: () => void;
}

const SpaceLayout: React.FC<SpaceLayoutProps> = ({ onBackToOverview }) => {
  const { activeWorkspace, updateWorkspaceConfig } = useWorkspaces();
  const [isChatHistoryOpen, setChatHistoryOpen] = useState(false);
  const toggleChatHistory = useCallback(
    () => setChatHistoryOpen((prev) => !prev),
    [],
  );
  const closeChatHistory = useCallback(() => setChatHistoryOpen(false), []);
  const [isConfigOpen, setConfigOpen] = useState(false);
  const openConfig = useCallback(() => setConfigOpen(true), []);
  const closeConfig = useCallback(() => setConfigOpen(false), []);

  // Room manager dialog state
  const [isRoomManagerOpen, setRoomManagerOpen] = useState(false);
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

  return (
    <Box display="flex" height="100%">
      <RightInspector onBackToOverview={onBackToOverview} />
      <Box flex={1} display="flex" flexDirection="column" minHeight={0}>
        <RoomTopBar onOpenManager={openRoomManager} />
        <SpaceTabs />
        <SpaceCanvas
          chatHistoryOpen={isChatHistoryOpen}
          onCloseChatHistory={closeChatHistory}
          onToggleChatHistory={toggleChatHistory}
        />
      </Box>
      {dialogInitialConfig && (
        <SpaceConfigDialog
          open={isConfigOpen}
          onClose={closeConfig}
          initialConfig={dialogInitialConfig}
          onSave={handleSaveConfig}
        />
      )}
      <RoomManagerDialog
        open={isRoomManagerOpen}
        onClose={closeRoomManager}
      />
    </Box>
  );
};

export default SpaceLayout;
