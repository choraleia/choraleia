import React, { useState } from "react";
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
            color={isActive ? "primary" : "default"}
            variant={isActive ? "filled" : "outlined"}
            onClick={() => selectRoom(room.id)}
            onContextMenu={(e) => handleContextMenu(e, room.id)}
            size="small"
            sx={{
              fontWeight: isActive ? 600 : 400,
              cursor: "pointer",
              height: 26,
              "&:hover": {
                bgcolor: isActive ? undefined : "action.hover",
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
            color={status === "error" ? "error" : "default"}
            variant="outlined"
            sx={{ height: 24, fontSize: "0.75rem" }}
          />
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
