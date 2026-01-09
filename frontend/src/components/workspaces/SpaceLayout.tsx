import React, { useCallback, useState, useMemo } from "react";
import { Box, ToggleButton, ToggleButtonGroup, Tooltip } from "@mui/material";
import ChatIcon from "@mui/icons-material/Chat";
import CodeIcon from "@mui/icons-material/Code";
import RoomTopBar from "./SpaceTopBar";
import WorkspaceExplorer from "./WorkspaceExplorer";
import SpaceConfigDialog from "./SpaceConfigDialog";
import RoomManagerDialog from "./RoomManagerDialog";
import ChatModeLayout from "./ChatModeLayout";
import IDEModeLayout from "./IDEModeLayout";
import { useWorkspaces, SpaceConfigInput, WorkMode } from "../../state/workspaces";

interface SpaceLayoutProps {
  onBackToOverview?: () => void;
  explorerVisible?: boolean;
}

const SpaceLayout: React.FC<SpaceLayoutProps> = ({ onBackToOverview, explorerVisible = true }) => {
  const { activeWorkspace, updateWorkspaceConfig, setWorkMode } = useWorkspaces();
  const [isConfigOpen, setConfigOpen] = useState(false);
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

  const workMode = activeWorkspace?.workMode || "chat";

  const handleModeChange = useCallback(
    (_: React.MouseEvent<HTMLElement>, newMode: WorkMode | null) => {
      if (newMode) {
        setWorkMode(newMode);
      }
    },
    [setWorkMode]
  );

  return (
    <Box display="flex" flexDirection="column" height="100%">
      {/* Top Bar with Mode Switcher - always at top */}
      <Box
        display="flex"
        alignItems="center"
        px={1}
        py={0.5}
        borderBottom={(theme) => `1px solid ${theme.palette.divider}`}
        gap={2}
      >
        {/* Left: Workspace selector and controls */}
        <Box display="flex" alignItems="center" gap={1} flexShrink={0}>
          <RoomTopBar
            onOpenManager={openRoomManager}
            onBackToOverview={onBackToOverview}
            section="left"
          />
        </Box>

        {/* Center: Room tabs - can expand */}
        <Box display="flex" alignItems="center" justifyContent="center" flex={1} gap={0.5} overflow="hidden">
          <RoomTopBar
            onOpenManager={openRoomManager}
            onBackToOverview={onBackToOverview}
            section="center"
          />
        </Box>

        {/* Right: Mode Switcher */}
        <Box display="flex" alignItems="center" gap={1} flexShrink={0}>
          <RoomTopBar
            onOpenManager={openRoomManager}
            onBackToOverview={onBackToOverview}
            section="right"
          />
          <ToggleButtonGroup
            value={workMode}
            exclusive
            onChange={handleModeChange}
            size="small"
            sx={{
              "& .MuiToggleButton-root": {
                px: 1.5,
                py: 0.25,
                textTransform: "none",
                fontSize: 12,
                border: "none",
                bgcolor: "transparent",
                "&.Mui-selected": {
                  bgcolor: "action.selected",
                  fontWeight: 600,
                  "&:hover": {
                    bgcolor: "action.selected",
                  },
                },
                "&:hover": {
                  bgcolor: "action.hover",
                },
              },
              // First button: round left corners only
              "& .MuiToggleButton-root:first-of-type": {
                borderRadius: "4px 0 0 4px",
              },
              // Last button: round right corners only
              "& .MuiToggleButton-root:last-of-type": {
                borderRadius: "0 4px 4px 0",
              },
            }}
          >
            <ToggleButton value="ide">
              <Tooltip title="IDE Mode - Traditional Development">
                <Box display="flex" alignItems="center" gap={0.5}>
                  <CodeIcon sx={{ fontSize: 16 }} />
                  IDE
                </Box>
              </Tooltip>
            </ToggleButton>
            <ToggleButton value="chat">
              <Tooltip title="AI Chat Mode - Work through conversation">
                <Box display="flex" alignItems="center" gap={0.5}>
                  <ChatIcon sx={{ fontSize: 16 }} />
                  Chat
                </Box>
              </Tooltip>
            </ToggleButton>
          </ToggleButtonGroup>
        </Box>
      </Box>

      {/* Content area below top bar */}
      <Box display="flex" flex={1} minHeight={0} width="100%">
        {/* WorkspaceExplorer only in IDE mode and when visible */}
        {workMode === "ide" && explorerVisible && <WorkspaceExplorer />}
        {/* Main content based on mode */}
        <Box flex={1} display="flex" flexDirection="column" minHeight={0} minWidth={0}>
          {workMode === "chat" ? <ChatModeLayout /> : <IDEModeLayout />}
        </Box>
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
