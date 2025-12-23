import React, { useEffect, useRef, useState } from "react";
import { tasksWSClient } from "./api/tasks_ws_client";
import { tasksStore } from "./api/tasks_store";
import StatusBar from "./components/StatusBar";
import Models from "./components/settings/models";
import AssetPage, { AssetPageHandle } from "./components/assets/AssetPage";
import TaskCenter from "./components/TaskCenter";

// MUI components
import { Box, IconButton } from "@mui/material";

// MUI icons
import DesktopMacIcon from "@mui/icons-material/DesktopMac";
import SettingsIcon from "@mui/icons-material/Settings";

// App
const App: React.FC = () => {
  const [selectedMenu, setSelectedMenu] = useState<"assets" | "settings">(
    "assets",
  );
  const [assetsVisible, setAssetsVisible] = useState<boolean>(true);
  const [taskCenterOpen, setTaskCenterOpen] = useState(false);
  const [tasksActive, setTasksActive] = useState(0);
  // Preserve app statistics
  const [appStats, setAppStats] = useState({
    memoryUsage: 0,
    cpuUsage: 0,
    version: "v1.0.0",
  });
  // Asset page ref
  const assetPageRef = useRef<AssetPageHandle>(null);

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

  // Trigger terminal resize: use activeTabKey exposed by AssetPage
  useEffect(() => {
    const trigger = () => {
      const tabKey = assetPageRef.current?.getActiveTabKey();
      if (!tabKey) return;
      window.dispatchEvent(
        new CustomEvent("terminal-resize", { detail: { tabKey } }),
      );
    };
    if (selectedMenu === "assets")
      [0, 60, 150].forEach((d) => setTimeout(trigger, d));
  }, [selectedMenu]);
  useEffect(() => {
    if (selectedMenu === "assets" && assetsVisible) {
      const trigger = () => {
        const tabKey = assetPageRef.current?.getActiveTabKey();
        if (!tabKey) return;
        window.dispatchEvent(
          new CustomEvent("terminal-resize", { detail: { tabKey } }),
        );
      };
      [0, 80, 180].forEach((d) => setTimeout(trigger, d));
    }
  }, [assetsVisible, selectedMenu]);

  const currentTerminal = assetPageRef.current?.getCurrentTerminalStatus();
  const totalTerminals = assetPageRef.current?.getTotalTerminals() || 0;
  const activeConnections =
    assetPageRef.current?.getActiveConnectionsCount() || 0;

  // Start the shared tasks events websocket once.
  // This avoids React StrictMode mount/unmount churn closing sockets.
  useEffect(() => {
    tasksWSClient.start();
    return () => {
      // Keep the socket alive even if App is remounted in dev; stop only on full teardown.
      // In typical Wails apps, App stays mounted for the process lifetime.
      tasksWSClient.stop();
    };
  }, []);

  // Keep the status bar task count updated even when TaskCenter is closed.
  useEffect(() => {
    return tasksStore.subscribe((s) => {
      const n = s.active.filter((t) => t.status === "running" || t.status === "queued").length;
      setTasksActive(n);
    });
  }, []);

  return (
    <Box display="flex" flexDirection="column" height="100%">
      <Box display="flex" flex={1} minHeight={0}>
        {/* Left Dock menu */}
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
            onClick={() => {
              if (selectedMenu !== "assets") {
                setSelectedMenu("assets");
                setAssetsVisible(true);
              } else {
                setAssetsVisible((v) => !v);
              }
            }}
            sx={(theme) => {
              const assetActive = selectedMenu === "assets";
              const assetShown = assetActive && assetsVisible;
              return {
                color: assetActive
                  ? assetShown
                    ? theme.palette.primary.main
                    : theme.palette.text.secondary
                  : theme.palette.text.secondary,
                bgcolor: assetShown
                  ? theme.palette.action.selected
                  : "transparent",
                borderRadius: 6,
                transition: "background-color 0.15s, color 0.15s",
                "&:hover": { bgcolor: theme.palette.action.hover },
              };
            }}
            title={assetsVisible ? "Hide Assets List" : "Show Assets List"}
          >
            <DesktopMacIcon fontSize="small" />
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

        {/* Right area: asset & settings views */}
        <Box flex={1} display="flex" flexDirection="column" minHeight={0}>
          <Box flex={1} display="flex" flexDirection="column" minHeight={0}>
            {/* Asset view */}
            <Box
              display={selectedMenu === "assets" ? "flex" : "none"}
              flex={1}
              flexDirection="column"
              minHeight={0}
            >
              <AssetPage ref={assetPageRef} assetsVisible={assetsVisible} />
            </Box>
            {/* Settings view */}
            <Box
              display={selectedMenu === "settings" ? "flex" : "none"}
              flex={1}
              flexDirection="column"
              overflow="hidden"
              minHeight={0}
            >
              <Models />
            </Box>
          </Box>
        </Box>
      </Box>

      <TaskCenter
        open={taskCenterOpen}
        onClose={() => setTaskCenterOpen(false)}
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
      />
    </Box>
  );
};

export default App;
