import React, { useCallback, useState } from "react";
import { Box } from "@mui/material";
import SpaceTabs from "./SpaceTabs";
import SpaceCanvas from "./SpaceCanvas";
import RightInspector from "./RightInspector";
import SpaceConfigDialog from "./SpaceConfigDialog";
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
  const handleSaveConfig = useCallback(
    (config: SpaceConfigInput) => {
      if (activeWorkspace) {
        updateWorkspaceConfig(activeWorkspace.id, config);
      }
      closeConfig();
    },
    [activeWorkspace, updateWorkspaceConfig, closeConfig],
  );
  return (
    <Box display="flex" height="100%">
      <RightInspector onBackToOverview={onBackToOverview} />
      <Box flex={1} display="flex" flexDirection="column" minHeight={0}>
        <SpaceTabs />
        <SpaceCanvas
          chatHistoryOpen={isChatHistoryOpen}
          onCloseChatHistory={closeChatHistory}
          onToggleChatHistory={toggleChatHistory}
        />
      </Box>
      {activeWorkspace && (
        <SpaceConfigDialog
          open={isConfigOpen}
          onClose={closeConfig}
          initialConfig={{
            name: activeWorkspace.name,
            description: activeWorkspace.description,
            workDirectories: activeWorkspace.workDirectories,
            assets: activeWorkspace.assets,
            tools: activeWorkspace.tools,
          }}
          onSave={handleSaveConfig}
        />
      )}
    </Box>
  );
};

export default SpaceLayout;
