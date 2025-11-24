import React, { useState, useEffect } from "react";
import { Box, Typography, IconButton, Tooltip } from "@mui/material"; // Removed Drawer
import HelpOutlineIcon from "@mui/icons-material/HelpOutline";
import SmartToyIcon from "@mui/icons-material/SmartToy";
import BoltIcon from "@mui/icons-material/Bolt";
import AiAssistant from "../ai-assitant/ai-assistant.tsx";
import QuickCommandsPanel from "./QuickCommandsPanel";

interface RightToolbarProps {
  style?: React.CSSProperties;
  tabs: any[];
  activeTabKey: string;
}

type ToolType =
  | "file-transfer"
  | "monitor"
  | "ai"
  | "quickcmd" // added missing quickcmd type
  | "tools"
  | "settings"
  | null;

interface DrawerState {
  open: boolean;
  type: ToolType;
  width: number;
}

const Toolbar: React.FC<RightToolbarProps> = ({
  style,
  tabs,
  activeTabKey,
}) => {
  const [drawerState, setDrawerState] = useState<DrawerState>({
    open: false,
    type: null,
    width: 400,
  });
  const [isResizing, setIsResizing] = useState(false);

  const toolButtons = [
    // { key: 'file-transfer', icon: <InsertDriveFileIcon fontSize="small" />, title: 'File Transfer', tooltip: 'File transfer tool' },
    // { key: 'monitor', icon: <MonitorIcon fontSize="small" />, title: 'Host Monitor', tooltip: 'Host monitor panel' },
    {
      key: "ai",
      icon: <SmartToyIcon fontSize="small" />,
      title: "AI Assistant",
      tooltip: "AI Intelligent Assistant",
    },
    {
      key: "quickcmd",
      icon: <BoltIcon fontSize="small" />,
      title: "Quick Commands",
      tooltip: "Quick Commands Panel",
    },
    // { key: 'tools', icon: <BuildIcon fontSize="small" />, title: 'Toolbox', tooltip: 'System toolbox' },
    // { key: 'settings', icon: <SettingsIcon fontSize="small" />, title: 'Settings', tooltip: 'Application settings' },
  ];

  const shortcutHints: Record<string, string[]> = {
    ai: ["Ctrl+Shift+L Toggle"],
    quickcmd: [
      "Ctrl+Shift+K Toggle",
      "Ctrl+K Search",
      "Enter Insert",
      "Ctrl/Shift+Enter Execute",
    ],
    // other panels can be added later
  };

  const handleButtonClick = (type: ToolType) => {
    setDrawerState((prev) => ({
      open: prev.type === type ? !prev.open : true,
      type,
      width: prev.width,
    }));
  };

  const handleCloseDrawer = () =>
    setDrawerState((prev) => ({ ...prev, open: false }));

  const getDrawerTitle = () => {
    const btn = toolButtons.find((b) => b.key === drawerState.type);
    if (!btn) return "";
    const hints = (shortcutHints[btn.key] || []).filter(
      (h) => !/^\(No preset/.test(h),
    );
    return (
      <Box display="flex" alignItems="center" gap={1}>
        <Typography variant="subtitle2" fontSize={14}>
          {btn.title}
        </Typography>
        {hints.length > 0 && (
          <Tooltip
            placement="bottom"
            arrow
            title={
              <Box display="flex" flexDirection="column" gap={0.5}>
                {hints.map((h) => (
                  <Typography
                    key={h}
                    variant="caption"
                    sx={{ lineHeight: 1.2 }}
                  >
                    {h}
                  </Typography>
                ))}
              </Box>
            }
          >
            <IconButton size="small" sx={{ p: 0.5 }}>
              <HelpOutlineIcon fontSize="inherit" />
            </IconButton>
          </Tooltip>
        )}
      </Box>
    );
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Quick Commands toggle
      if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setDrawerState((prev) => {
          if (prev.type === "quickcmd") {
            return { ...prev, open: !prev.open };
          }
          return { open: true, type: "quickcmd", width: prev.width };
        });
        return;
      }
      if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === "l") {
        e.preventDefault();
        setDrawerState((prev) => {
          if (prev.type === "ai") {
            return { ...prev, open: !prev.open };
          }
          return { open: true, type: "ai", width: prev.width };
        });
        return;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <Box
      height="100%"
      display="flex"
      flexDirection="row"
      sx={{ pointerEvents: "auto" }}
    >
      {/* Dock */}
      <Box
        style={style}
        sx={(theme) => ({
          width: 40,
          height: "100%",
          background: theme.palette.background.default,
          borderLeft: `1px solid ${theme.palette.divider}`,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          py: 2,
          flexShrink: 0,
          zIndex: 1300,
        })}
      >
        {toolButtons.map((button, index) => {
          const isActive = drawerState.type === button.key && drawerState.open;
          return (
            <IconButton
              key={button.key}
              title={button.tooltip}
              onClick={() => handleButtonClick(button.key as ToolType)}
              sx={(theme) => ({
                width: 32,
                height: 32,
                mb: index < toolButtons.length - 1 ? 1 : 0,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                borderRadius: "6px",
                color: isActive
                  ? theme.palette.getContrastText(theme.palette.primary.main)
                  : theme.palette.text.secondary,
                backgroundColor: isActive
                  ? theme.palette.primary.main
                  : "transparent",
                transition: "color 0.15s, background-color 0.15s",
                "&:hover": {
                  backgroundColor: isActive
                    ? theme.palette.primary.main
                    : theme.palette.action.hover,
                  color: isActive
                    ? theme.palette.getContrastText(theme.palette.primary.main)
                    : theme.palette.text.primary,
                },
              })}
            >
              {button.icon}
            </IconButton>
          );
        })}
      </Box>

      {/* Persistent panel: keep mounted to retain internal state (AI Assistant) */}
      <Box
        sx={(theme) => ({
          position: "fixed",
          right: 40, // keep space for the dock itself
          top: 0,
          height: "calc(100% - 24px)",
          width: drawerState.width,
          display: drawerState.open ? "flex" : "none",
          flexDirection: "column",
          borderLeft: `1px solid ${theme.palette.divider}`,
          boxShadow:
            theme.palette.mode === "light"
              ? "0 0 8px rgba(0,0,0,0.15)"
              : "0 0 8px rgba(0,0,0,0.5)",
          overflow: "hidden",
          backgroundColor: theme.palette.background.paper,
          zIndex: 1299,
        })}
      >
        {/* Resize handle */}
        <Box
          sx={{
            position: "absolute",
            left: -4,
            top: 0,
            width: 8,
            height: "100%",
            cursor: "ew-resize",
            bgcolor: isResizing ? "rgba(24,144,255,0.3)" : "transparent",
            transition: isResizing ? "none" : "background-color 0.2s ease",
          }}
          onMouseDown={(e) => {
            setIsResizing(true);
            e.preventDefault();
            const startX = e.clientX;
            const startWidth = drawerState.width;
            document.body.style.cursor = "ew-resize";
            document.body.style.userSelect = "none";
            // Use fixed left main menu width provided by user instead of querying DOM.
            const LEFT_MENU_WIDTH = 40; // left main menu width
            const dockWidth = 40; // right dock width (this component's button column)
            const minWidth = 300;
            const handleMove = (me: MouseEvent) => {
              me.preventDefault();
              const delta = startX - me.clientX; // dragging left increases width
              const desiredWidth = startWidth + delta;
              // Maximum width so drawer's left edge never crosses left menu right edge.
              // Drawer left edge = window.innerWidth - dockWidth - currentWidth
              const computedMax =
                window.innerWidth - dockWidth - LEFT_MENU_WIDTH;
              const maxWidth = Math.max(minWidth, computedMax);
              const newWidth = Math.min(
                maxWidth,
                Math.max(minWidth, desiredWidth),
              );
              requestAnimationFrame(() =>
                setDrawerState((prev) => ({ ...prev, width: newWidth })),
              );
            };
            const handleUp = () => {
              setIsResizing(false);
              document.removeEventListener("mousemove", handleMove);
              document.removeEventListener("mouseup", handleUp);
              document.body.style.cursor = "";
              document.body.style.userSelect = "";
            };
            document.addEventListener("mousemove", handleMove, {
              passive: false,
            });
            document.addEventListener("mouseup", handleUp);
          }}
        />
        <Box
          px={1.5}
          py={1}
          sx={(theme) => ({
            borderBottom: `1px solid ${theme.palette.divider}`,
            flexShrink: 0,
            position: "relative",
            height: 40,
          })}
          display="flex"
          alignItems="center"
          justifyContent="space-between"
        >
          {getDrawerTitle()}
          <IconButton onClick={handleCloseDrawer} sx={{ ml: 1 }}>
            ✕
          </IconButton>
        </Box>
        <Box flex={1} overflow="auto" display="flex" flexDirection="column">
          {/* Tool content sections (kept mounted) */}
          <Box
            sx={{
              flex: 1,
              display: drawerState.type === "ai" ? "flex" : "none",
              flexDirection: "column",
              minHeight: 0,
            }}
          >
            <AiAssistant
              tabs={tabs}
              activeTabKey={activeTabKey}
              visible={drawerState.open && drawerState.type === "ai"}
            />
          </Box>
          <Box
            sx={{
              flex: 1,
              display: drawerState.type === "quickcmd" ? "flex" : "none",
              flexDirection: "column",
              minHeight: 0,
            }}
          >
            <QuickCommandsPanel activeTabKey={activeTabKey} />
          </Box>
        </Box>
      </Box>
    </Box>
  );
};

export default Toolbar;
