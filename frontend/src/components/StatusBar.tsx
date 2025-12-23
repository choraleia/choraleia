import React, { useState, useEffect } from "react";
import { Box, Typography, Chip } from "@mui/material";
import WifiIcon from "@mui/icons-material/Wifi";
import AccessTimeIcon from "@mui/icons-material/AccessTime";
import DesktopMacIcon from "@mui/icons-material/DesktopMac";
import StorageIcon from "@mui/icons-material/Storage";
import BugReportIcon from "@mui/icons-material/BugReport";
import FlashOnIcon from "@mui/icons-material/FlashOn";

interface StatusBarProps {
  currentTerminal?: {
    name: string;
    ip: string;
    port: number;
    connected: boolean;
    connectionTime?: number;
  };
  totalTerminals: number;
  activeConnections: number;
  appVersion?: string;
  memoryUsage?: number;
  cpuUsage?: number;
  tasksActive?: number;
  onTasksClick?: () => void;
}

const StatusBar: React.FC<StatusBarProps> = ({
  currentTerminal,
  totalTerminals,
  activeConnections,
  appVersion = "v1.0.0",
  memoryUsage = 0,
  cpuUsage = 0,
  tasksActive = 0,
  onTasksClick,
}) => {
  const [currentTime, setCurrentTime] = useState<string>("");
  const [connectionDuration, setConnectionDuration] = useState<string>("");

  // Update current time
  useEffect(() => {
    const updateTime = () => {
      setCurrentTime(
        new Date().toLocaleTimeString("zh-CN", {
          hour12: false,
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        }),
      );
    };

    updateTime();
    const interval = setInterval(updateTime, 1000);
    return () => clearInterval(interval);
  }, []);

  // Update connection duration
  useEffect(() => {
    if (!currentTerminal?.connected || !currentTerminal.connectionTime) {
      setConnectionDuration("");
      return;
    }

    const updateDuration = () => {
      const now = Date.now();
      const duration = Math.floor(
        (now - currentTerminal.connectionTime!) / 1000,
      );
      const hours = Math.floor(duration / 3600);
      const minutes = Math.floor((duration % 3600) / 60);
      const seconds = duration % 60;

      if (hours > 0) {
        setConnectionDuration(
          `${hours}:${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`,
        );
      } else {
        setConnectionDuration(
          `${minutes}:${seconds.toString().padStart(2, "0")}`,
        );
      }
    };

    updateDuration();
    const interval = setInterval(updateDuration, 1000);
    return () => clearInterval(interval);
  }, [currentTerminal?.connected, currentTerminal?.connectionTime]);

  const statusColor = !currentTerminal
    ? "#8c8c8c"
    : currentTerminal.connected
      ? "#52c41a"
      : "#ff4d4f";
  const statusText = !currentTerminal
    ? "No Connection"
    : currentTerminal.connected
      ? "Connected"
      : "Disconnected";
  const formatMem = (u: number) =>
    u < 1024 ? `${u.toFixed(1)}MB` : `${(u / 1024).toFixed(1)}GB`;

  const Divider: React.FC = () => (
    <Box
      component="span"
      sx={{
        mx: 1,
        height: 12,
        width: 1,
        bgcolor: "#d9d9d9",
        display: "inline-block",
        verticalAlign: "middle",
      }}
    />
  );

  return (
    <Box
      sx={{
        height: 24,
        background: "#f5f5f5",
        borderTop: "1px solid #d9d9d9",
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        px: 1.5,
        fontSize: 11,
        color: "#666",
        userSelect: "none",
        zIndex: 1000,
        writingMode: "horizontal-tb",
        whiteSpace: "nowrap",
        "& *": { writingMode: "horizontal-tb" },
      }}
    >
      {/* Left side: connection & terminal info */}
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          gap: 2,
          minWidth: 0,
          flexShrink: 0,
        }}
      >
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            gap: 0.75,
            minWidth: 0,
            flexShrink: 0,
          }}
        >
          <Box
            sx={{
              width: 8,
              height: 8,
              borderRadius: "50%",
              bgcolor: statusColor,
              flexShrink: 0,
            }}
          />
          {currentTerminal ? (
            <>
              <Typography sx={{ fontSize: 11 }} noWrap>
                {currentTerminal.name} ({currentTerminal.ip}:
                {currentTerminal.port})
              </Typography>
              <Typography sx={{ fontSize: 11, color: statusColor }} noWrap>
                {statusText}
              </Typography>
              {connectionDuration && (
                <Typography sx={{ fontSize: 11 }} noWrap>
                  {connectionDuration}
                </Typography>
              )}
            </>
          ) : (
            <Typography sx={{ fontSize: 11, color: "#8c8c8c" }} noWrap>
              No Connection
            </Typography>
          )}
        </Box>
        <Divider />
        <Box
          sx={{ display: "flex", alignItems: "center", gap: 1, flexShrink: 0 }}
        >
          <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
            <DesktopMacIcon sx={{ fontSize: 14 }} />
            <Typography sx={{ fontSize: 11 }} noWrap>
              Terminal {totalTerminals}
            </Typography>
          </Box>
          <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
            <WifiIcon
              sx={{
                fontSize: 14,
                color: activeConnections > 0 ? "#52c41a" : "#8c8c8c",
              }}
            />
            <Typography sx={{ fontSize: 11 }} noWrap>
              Connections {activeConnections}
            </Typography>
          </Box>
        </Box>
      </Box>
      {/* Right side: performance & version time */}
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          gap: 2,
          ml: "auto",
          flexShrink: 0,
        }}
      >
        <Chip
          size="small"
          variant="outlined"
          label={`Tasks ${tasksActive}`}
          onClick={onTasksClick}
          clickable
          sx={{
            height: 18,
            fontSize: 11,
            borderRadius: 0,
            backgroundColor: "transparent",
            "& .MuiChip-label": { px: 0.75 },
            borderColor: "transparent",
            color: tasksActive > 0 ? "#ad6800" : "#666",
          }}
        />
        <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
          <FlashOnIcon sx={{ fontSize: 14 }} />
          <Typography sx={{ fontSize: 11 }} noWrap>
            CPU {cpuUsage.toFixed(1)}%
          </Typography>
        </Box>
        <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
          <StorageIcon sx={{ fontSize: 14 }} />
          <Typography sx={{ fontSize: 11 }} noWrap>
            Memory {formatMem(memoryUsage)}
          </Typography>
        </Box>
        <Divider />
        <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
          <BugReportIcon sx={{ fontSize: 14 }} />
          <Typography sx={{ fontSize: 11 }} noWrap>
            {appVersion}
          </Typography>
        </Box>
        <Divider />
        <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
          <AccessTimeIcon sx={{ fontSize: 14 }} />
          <Typography sx={{ fontSize: 11 }} noWrap>
            {currentTime}
          </Typography>
        </Box>
      </Box>
    </Box>
  );
};

export default StatusBar;
