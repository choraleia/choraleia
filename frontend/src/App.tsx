import React, { useEffect, useRef, useState } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { useEventClientInit } from "./api/event_hooks";
import {
  queryClient,
  useTasks,
  useTunnelStats,
  initAssetEvents,
  initTaskEvents,
  initTunnelEvents,
  initFileManagerEvents,
} from "./stores";
import TaskCenter from "./components/TaskCenter";
import TunnelManager from "./components/TunnelManager";

// MUI components
import { Box, IconButton } from "@mui/material";
import DesktopMacIcon from "@mui/icons-material/DesktopMac";
import SettingsIcon from "@mui/icons-material/Settings";
import SpaceDashboardIcon from "@mui/icons-material/SpaceDashboard";
import StatusBar from "./components/StatusBar";
import Models from "./components/settings/models";
import AssetPage, { AssetPageHandle } from "./components/assets/AssetPage";
import SpaceLayout from "./components/workspaces/SpaceLayout";
import SpacesView from "./components/workspaces/SpacesView";
import SettingsPage from "./components/settings/SettingsPage.tsx";

// Initialize global event subscriptions (must be before component render)
initAssetEvents(queryClient);
initTaskEvents(queryClient);
initTunnelEvents(queryClient);
initFileManagerEvents(queryClient);

// Inner component that uses hooks (must be inside QueryClientProvider)
const AppContent: React.FC = () => {
  const [selectedMenu, setSelectedMenu] = useState<"assets" | "spaces" | "settings">(
    "assets",
  );
  const [assetsVisible, setAssetsVisible] = useState<boolean>(true);
  const [spacesExplorerVisible, setSpacesExplorerVisible] = useState<boolean>(true);
  const [taskCenterOpen, setTaskCenterOpen] = useState(false);
  const [tunnelManagerOpen, setTunnelManagerOpen] = useState(false);
  // Preserve app statistics
  const [appStats, setAppStats] = useState({
    memoryUsage: 0,
    cpuUsage: 0,
    version: "v1.0.0",
  });
  const assetPageRef = useRef<AssetPageHandle>(null);

  // Initialize event client for real-time notifications
  useEventClientInit();

  // Get task and tunnel stats from stores
  const { active: activeTasks } = useTasks();
  const { data: tunnelStats } = useTunnelStats();

  const tasksActive = activeTasks.length;

  useEffect(() => {
    const update = () =>
      setAppStats((p) => ({
        ...p,
        memoryUsage: Math.random() * 512 + 128,
        cpuUsage: Math.random() * 30 + 5,
      }));
    update();
    const id = setInterval(update, 5000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const trigger = () => {
      const tabKey = assetPageRef.current?.getActiveTabKey();
      if (!tabKey) return;
      window.dispatchEvent(
        new CustomEvent("terminal-resize", { detail: { tabKey } }),
      );
    };
    if (selectedMenu === "assets")
      [0, 60, 150].forEach((delay) => setTimeout(trigger, delay));
  }, [selectedMenu]);

  useEffect(() => {
    if (selectedMenu !== "assets" || !assetsVisible) return;
    const trigger = () => {
      const tabKey = assetPageRef.current?.getActiveTabKey();
      if (!tabKey) return;
      window.dispatchEvent(
        new CustomEvent("terminal-resize", { detail: { tabKey } }),
      );
    };
    [0, 80, 180].forEach((delay) => setTimeout(trigger, delay));
  }, [assetsVisible, selectedMenu]);

  const currentTerminal = assetPageRef.current?.getCurrentTerminalStatus();
  const totalTerminals = assetPageRef.current?.getTotalTerminals() || 0;
  const activeConnections = assetPageRef.current?.getActiveConnectionsCount() || 0;

  const handleAssetsClick = () => {
    if (selectedMenu !== "assets") {
      setSelectedMenu("assets");
      setAssetsVisible(true);
      return;
    }
    setAssetsVisible((prev) => !prev);
  };

  const handleSpacesClick = () => {
    if (selectedMenu !== "spaces") {
      setSelectedMenu("spaces");
      setSpacesExplorerVisible(true);
      return;
    }
    setSpacesExplorerVisible((prev) => !prev);
  };

  return (
    <Box display="flex" flexDirection="column" height="100%">
      <Box display="flex" flex={1} minHeight={0}>
        <Box
          width={40}
          sx={(theme) => ({
            bgcolor: theme.palette.background.default,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            py: 1,
            gap: 1,
            borderRight: `1px solid ${theme.palette.divider}`,
          })}
        >
          <IconButton
            onClick={handleAssetsClick}
            sx={(theme) => {
              const assetActive = selectedMenu === "assets";
              const shown = assetActive && assetsVisible;
              return {
                color: assetActive
                  ? shown
                    ? theme.palette.primary.main
                    : theme.palette.text.secondary
                  : theme.palette.text.secondary,
                bgcolor: shown ? theme.palette.action.selected : "transparent",
                borderRadius: 6,
                transition: "background-color 0.15s, color 0.15s",
                "&:hover": { bgcolor: theme.palette.action.hover },
              };
            }}
            title={assetsVisible && selectedMenu === "assets" ? "Hide Assets" : "Show Assets"}
          >
            <DesktopMacIcon fontSize="small" />
          </IconButton>
          <IconButton
            onClick={handleSpacesClick}
            sx={(theme) => {
              const spacesActive = selectedMenu === "spaces";
              const shown = spacesActive && spacesExplorerVisible;
              return {
                color: spacesActive
                  ? shown
                    ? theme.palette.primary.main
                    : theme.palette.text.secondary
                  : theme.palette.text.secondary,
                bgcolor: shown ? theme.palette.action.selected : "transparent",
                borderRadius: 6,
                transition: "background-color 0.15s, color 0.15s",
                "&:hover": { bgcolor: theme.palette.action.hover },
              };
            }}
            title={spacesExplorerVisible && selectedMenu === "spaces" ? "Hide Explorer" : "Show Spaces"}
          >
            <SpaceDashboardIcon fontSize="small" />
          </IconButton>
          <Box flexGrow={1} />
          <IconButton
            onClick={() => setSelectedMenu("settings")}
            sx={(theme) => ({
              color:
                selectedMenu === "settings"
                  ? theme.palette.primary.main
                  : theme.palette.text.secondary,
              bgcolor:
                selectedMenu === "settings"
                  ? theme.palette.action.selected
                  : "transparent",
              borderRadius: 6,
              mt: "auto",
              transition: "background-color 0.15s, color 0.15s",
              "&:hover": { bgcolor: theme.palette.action.hover },
            })}
            title="Settings"
          >
            <SettingsIcon fontSize="small" />
          </IconButton>
        </Box>

        <Box flex={1} display="flex" flexDirection="column" minHeight={0}>
          <Box flex={1} display="flex" flexDirection="column" minHeight={0}>
            <Box
              display={selectedMenu === "assets" ? "flex" : "none"}
              flex={1}
              flexDirection="column"
              minHeight={0}
            >
              <AssetPage ref={assetPageRef} assetsVisible={assetsVisible} />
            </Box>
            <Box
              display={selectedMenu === "spaces" ? "flex" : "none"}
              flex={1}
              flexDirection="column"
              minHeight={0}
            >
              <SpacesView explorerVisible={spacesExplorerVisible} />
            </Box>
            <Box
              display={selectedMenu === "settings" ? "flex" : "none"}
              flex={1}
              flexDirection="column"
              overflow="hidden"
              minHeight={0}
            >
              <SettingsPage />
            </Box>
          </Box>
        </Box>
      </Box>

      <TaskCenter
        open={taskCenterOpen}
        onClose={() => setTaskCenterOpen(false)}
      />

      <TunnelManager
        open={tunnelManagerOpen}
        onClose={() => setTunnelManagerOpen(false)}
      />

      {/* Bottom status bar */}
      <StatusBar
        currentTerminal={currentTerminal}
        totalTerminals={totalTerminals}
        activeConnections={activeConnections}
        appVersion={appStats.version}
        memoryUsage={appStats.memoryUsage}
        cpuUsage={appStats.cpuUsage}
        tasksActive={tasksActive}
        onTasksClick={() => setTaskCenterOpen(true)}
        tunnelsRunning={tunnelStats?.running ?? 0}
        tunnelsTotal={tunnelStats?.total ?? 0}
        onTunnelsClick={() => setTunnelManagerOpen(true)}
      />
    </Box>
  );
};

// App wrapper - provides QueryClientProvider
const App: React.FC = () => {
  return (
    <QueryClientProvider client={queryClient}>
      <AppContent />
    </QueryClientProvider>
  );
};

export default App;
