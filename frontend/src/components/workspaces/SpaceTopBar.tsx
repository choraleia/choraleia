import React, { useState, useCallback } from "react";
import {
  Box,
  Chip,
  IconButton,
  Tooltip,
  Menu,
  MenuItem,
  ListItemIcon,
  ListItemText,
  Divider,
  CircularProgress,
  Select,
  Popover,
  Typography,
} from "@mui/material";
import DashboardIcon from "@mui/icons-material/Dashboard";
import AddIcon from "@mui/icons-material/Add";
import EditIcon from "@mui/icons-material/Edit";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import DeleteIcon from "@mui/icons-material/Delete";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import StopIcon from "@mui/icons-material/Stop";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import { useWorkspaces } from "../../state/workspaces";

// Detailed status response type
type RuntimeDetailedStatus = {
  workspace_id: string;
  phase: string;
  message?: string;
  progress?: number;
  error?: string;
  container_id?: string;
  container_name?: string;
  container_status?: string;
  container_image?: string;
  started_at?: string;
  last_updated_at: string;
  resources?: {
    cpu_percent: number;
    memory_percent: number;
    memory_usage: number;
    memory_limit: number;
  };
};

type WorkspaceStatusResponse = {
  status: string;
  runtime?: {
    type: string;
    container_id?: string;
    container_status?: string;
    uptime?: number;
  };
  runtime_detailed?: RuntimeDetailedStatus;
};

interface RoomTopBarProps {
  onOpenManager: () => void;
  onBackToOverview?: () => void;
}

const RoomTopBar: React.FC<RoomTopBarProps> = ({ onOpenManager, onBackToOverview }) => {
  const { workspaces, activeWorkspaceId, activeWorkspace, selectWorkspace, selectRoom, createRoom, deleteRoom, duplicateRoom, startWorkspace, stopWorkspace } = useWorkspaces();

  // Context menu state
  const [menuAnchor, setMenuAnchor] = useState<null | HTMLElement>(null);
  const [menuRoomId, setMenuRoomId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  // Status popover state
  const [statusAnchor, setStatusAnchor] = useState<null | HTMLElement>(null);
  const [detailedStatus, setDetailedStatus] = useState<WorkspaceStatusResponse | null>(null);
  const [statusLoading, setStatusLoading] = useState(false);

  const fetchDetailedStatus = useCallback(async (workspaceId: string) => {
    if (statusLoading) return;
    setStatusLoading(true);
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/status`);
      if (res.ok) {
        const data = await res.json();
        setDetailedStatus(data);
      }
    } catch (err) {
      console.error("Failed to fetch workspace status:", err);
    } finally {
      setStatusLoading(false);
    }
  }, [statusLoading]);

  const handleStatusClick = (event: React.MouseEvent<HTMLElement>) => {
    setStatusAnchor(event.currentTarget);
    if (activeWorkspace) {
      fetchDetailedStatus(activeWorkspace.id);
    }
  };

  const handleStatusClose = () => {
    setStatusAnchor(null);
  };

  const formatUptime = (seconds?: number) => {
    if (!seconds) return "N/A";
    if (seconds < 60) return `${seconds}s`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
    const hours = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    return `${hours}h ${mins}m`;
  };

  const formatBytes = (bytes?: number) => {
    if (!bytes) return "N/A";
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  };

  if (!activeWorkspace) return null;
  const { rooms, activeRoomId, status } = activeWorkspace;

  const handleContextMenu = (event: React.MouseEvent<HTMLElement>, roomId: string) => {
    event.preventDefault();
    setMenuAnchor(event.currentTarget);
    setMenuRoomId(roomId);
  };

  const handleMenuClose = () => {
    setMenuAnchor(null);
    setMenuRoomId(null);
  };

  const handleDelete = () => {
    if (menuRoomId && rooms.length > 1) {
      deleteRoom(menuRoomId);
    }
    handleMenuClose();
  };

  const handleStartStop = async () => {
    if (isLoading) return;
    setIsLoading(true);
    try {
      if (status === "running") {
        await stopWorkspace?.(activeWorkspace.id);
      } else {
        await startWorkspace?.(activeWorkspace.id);
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleDuplicate = () => {
    if (menuRoomId) {
      duplicateRoom(menuRoomId);
    }
    handleMenuClose();
  };

  // Only show status for Docker runtimes
  const showStatus = activeWorkspace.runtime.type === "docker-local" || activeWorkspace.runtime.type === "docker-remote";

  return (
    <Box
      display="flex"
      alignItems="center"
      gap={0.5}
    >
      {/* Back button */}
      {onBackToOverview && (
        <Tooltip title="Back to Workspaces">
          <IconButton size="small" onClick={onBackToOverview}>
            <ArrowBackIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      )}


      {/* Workspace switcher */}
      <Select
        size="small"
        value={activeWorkspaceId || ""}
        onChange={(event) => selectWorkspace(event.target.value as string)}
        sx={{
          minWidth: 120,
          maxWidth: 180,
          "& .MuiSelect-select": {
            py: 0.5,
            fontSize: 13,
          },
        }}
      >
        {workspaces.map((workspace) => (
          <MenuItem key={workspace.id} value={workspace.id} sx={{ fontSize: 13 }}>
            {workspace.name}
          </MenuItem>
        ))}
      </Select>

      <Divider orientation="vertical" flexItem sx={{ mx: 0.5 }} />

      {/* Manage rooms button */}
      <Tooltip title="Manage Rooms">
        <IconButton onClick={onOpenManager} size="small">
          <DashboardIcon fontSize="small" />
        </IconButton>
      </Tooltip>

      {/* Room tabs */}
      {rooms.map((room) => {
        const isActive = room.id === activeRoomId;
        return (
          <Chip
            key={room.id}
            label={room.name}
            variant="filled"
            onClick={() => selectRoom(room.id)}
            onContextMenu={(e) => handleContextMenu(e, room.id)}
            size="small"
            sx={{
              fontWeight: isActive ? 600 : 400,
              cursor: "pointer",
              height: 24,
              fontSize: "0.75rem",
              bgcolor: isActive ? "primary.main" : "transparent",
              color: isActive ? "primary.contrastText" : "text.primary",
              border: "none",
              "&:hover": {
                bgcolor: isActive ? "primary.dark" : "action.hover",
              },
            }}
          />
        );
      })}

      {/* Add room button */}
      <Tooltip title="New Room">
        <IconButton size="small" onClick={createRoom}>
          <AddIcon fontSize="small" />
        </IconButton>
      </Tooltip>

      {/* Workspace status - only for Docker */}
      {showStatus && (
        <>
          <Divider orientation="vertical" flexItem sx={{ mx: 0.5 }} />
          <Chip
            size="small"
            label={status}
            variant="filled"
            sx={{
              height: 22,
              fontSize: "0.7rem",
              cursor: "pointer",
              bgcolor: status === "error" ? "error.main" : status === "running" ? "success.main" : "action.selected",
              color: status === "error" || status === "running" ? "common.white" : "text.primary",
              border: "none",
              fontWeight: 500,
            }}
            onClick={handleStatusClick}
          />
          <Popover
            open={Boolean(statusAnchor)}
            anchorEl={statusAnchor}
            onClose={handleStatusClose}
            anchorOrigin={{
              vertical: "bottom",
              horizontal: "center",
            }}
            transformOrigin={{
              vertical: "top",
              horizontal: "center",
            }}
            slotProps={{
              paper: {
                sx: { mt: 0.5 },
              },
            }}
          >
            <Box sx={{ p: 1.5, minWidth: 220, maxWidth: 360 }}>
              {statusLoading && !detailedStatus ? (
                <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                  <CircularProgress size={14} />
                  <Typography variant="caption">Loading...</Typography>
                </Box>
              ) : (
                <>
                  <Typography variant="caption" fontWeight={600} display="block" gutterBottom>
                    Status: {status}
                  </Typography>

                  {detailedStatus?.runtime_detailed?.phase &&
                   detailedStatus.runtime_detailed.phase !== "idle" && (
                    <Typography variant="caption" display="block" color="text.secondary">
                      Phase: {detailedStatus.runtime_detailed.phase}
                    </Typography>
                  )}

                  {detailedStatus?.runtime_detailed?.message && (
                    <Typography variant="caption" display="block" color="text.secondary">
                      {detailedStatus.runtime_detailed.message}
                    </Typography>
                  )}

                  {detailedStatus?.runtime_detailed?.progress !== undefined &&
                   detailedStatus.runtime_detailed.progress > 0 &&
                   detailedStatus.runtime_detailed.progress < 100 && (
                    <Typography variant="caption" display="block" color="text.secondary">
                      Progress: {detailedStatus.runtime_detailed.progress}%
                    </Typography>
                  )}

                  {detailedStatus?.runtime_detailed?.error && (
                    <Typography
                      variant="caption"
                      display="block"
                      color="text.secondary"
                      sx={{
                        wordBreak: "break-word",
                        whiteSpace: "pre-wrap",
                      }}
                    >
                      Error: {detailedStatus.runtime_detailed.error}
                    </Typography>
                  )}

                  {(detailedStatus?.runtime_detailed?.container_name || detailedStatus?.runtime?.container_id) && (
                    <Typography variant="caption" display="block" color="text.secondary" sx={{ fontFamily: "monospace" }}>
                      Container: {detailedStatus?.runtime_detailed?.container_name || detailedStatus?.runtime?.container_id?.slice(0, 12)}
                    </Typography>
                  )}

                  {detailedStatus?.runtime?.uptime !== undefined && detailedStatus.runtime.uptime > 0 && (
                    <Typography variant="caption" display="block" color="text.secondary">
                      Uptime: {formatUptime(detailedStatus.runtime.uptime)}
                    </Typography>
                  )}

                  {detailedStatus?.runtime_detailed?.resources && (
                    <>
                      <Divider sx={{ my: 0.5 }} />
                      <Typography variant="caption" display="block" color="text.secondary">
                        CPU: {detailedStatus.runtime_detailed.resources.cpu_percent.toFixed(1)}%
                      </Typography>
                      <Typography variant="caption" display="block" color="text.secondary">
                        Memory: {formatBytes(detailedStatus.runtime_detailed.resources.memory_usage)} / {formatBytes(detailedStatus.runtime_detailed.resources.memory_limit)} ({detailedStatus.runtime_detailed.resources.memory_percent.toFixed(1)}%)
                      </Typography>
                    </>
                  )}

                  {detailedStatus?.runtime_detailed?.last_updated_at && (
                    <Typography variant="caption" display="block" color="text.disabled" sx={{ mt: 0.5, fontSize: "0.65rem" }}>
                      Updated: {new Date(detailedStatus.runtime_detailed.last_updated_at).toLocaleTimeString()}
                    </Typography>
                  )}

                  {!detailedStatus?.runtime_detailed && !detailedStatus?.runtime && !statusLoading && (
                    <Typography variant="caption" color="text.secondary">
                      No detailed status available
                    </Typography>
                  )}
                </>
              )}
            </Box>
          </Popover>
          <Tooltip title={status === "running" ? "Stop Container" : "Start Container"}>
            <IconButton
              size="small"
              onClick={handleStartStop}
              disabled={isLoading || status === "starting" || status === "stopping"}
            >
              {isLoading || status === "starting" || status === "stopping" ? (
                <CircularProgress size={16} />
              ) : status === "running" ? (
                <StopIcon fontSize="small" />
              ) : (
                <PlayArrowIcon fontSize="small" />
              )}
            </IconButton>
          </Tooltip>
        </>
      )}

      {/* Context Menu */}
      <Menu
        anchorEl={menuAnchor}
        open={Boolean(menuAnchor)}
        onClose={handleMenuClose}
        anchorOrigin={{ vertical: "bottom", horizontal: "left" }}
        transformOrigin={{ vertical: "top", horizontal: "left" }}
      >
        <MenuItem onClick={onOpenManager}>
          <ListItemIcon>
            <EditIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText primaryTypographyProps={{ variant: "body2" }}>Rename</ListItemText>
        </MenuItem>
        <MenuItem onClick={handleDuplicate}>
          <ListItemIcon>
            <ContentCopyIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText primaryTypographyProps={{ variant: "body2" }}>Duplicate</ListItemText>
        </MenuItem>
        <Divider />
        <MenuItem
          onClick={handleDelete}
          disabled={rooms.length <= 1}
        >
          <ListItemIcon>
            <DeleteIcon fontSize="small" color={rooms.length > 1 ? "error" : "disabled"} />
          </ListItemIcon>
          <ListItemText
            primaryTypographyProps={{
              variant: "body2",
              color: rooms.length > 1 ? "error" : "text.disabled"
            }}
          >
            Delete
          </ListItemText>
        </MenuItem>
      </Menu>
    </Box>
  );
};

export default RoomTopBar;
