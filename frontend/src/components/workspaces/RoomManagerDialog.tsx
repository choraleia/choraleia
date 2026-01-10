import React, { useState } from "react";
import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  List,
  ListItem,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  TextField,
  Typography,
  Tooltip,
  Menu,
  MenuItem,
  Divider,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import DeleteIcon from "@mui/icons-material/Delete";
import EditIcon from "@mui/icons-material/Edit";
import MoreVertIcon from "@mui/icons-material/MoreVert";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import CheckIcon from "@mui/icons-material/Check";
import DashboardIcon from "@mui/icons-material/Dashboard";
import { useWorkspaces, Room } from "../../state/workspaces";

interface RoomManagerDialogProps {
  open: boolean;
  onClose: () => void;
}

const RoomManagerDialog: React.FC<RoomManagerDialogProps> = ({ open, onClose }) => {
  const { activeWorkspace, selectRoom, createRoom, renameRoom, deleteRoom, duplicateRoom } = useWorkspaces();

  // Edit state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");

  // Context menu state
  const [menuAnchor, setMenuAnchor] = useState<null | HTMLElement>(null);
  const [menuRoomId, setMenuRoomId] = useState<string | null>(null);

  if (!activeWorkspace) return null;

  const { rooms, activeRoomId } = activeWorkspace;

  const handleStartEdit = (room: Room) => {
    setEditingId(room.id);
    setEditName(room.name);
  };

  const handleSaveEdit = () => {
    if (editingId && editName.trim()) {
      renameRoom(editingId, editName.trim());
    }
    setEditingId(null);
    setEditName("");
  };

  const handleCancelEdit = () => {
    setEditingId(null);
    setEditName("");
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      handleSaveEdit();
    } else if (e.key === "Escape") {
      handleCancelEdit();
    }
  };

  const handleMenuOpen = (event: React.MouseEvent<HTMLElement>, roomId: string) => {
    event.stopPropagation();
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

  const handleDuplicate = () => {
    if (menuRoomId) {
      duplicateRoom(menuRoomId);
    }
    handleMenuClose();
  };

  const handleRename = () => {
    const room = rooms.find((r) => r.id === menuRoomId);
    if (room) {
      handleStartEdit(room);
    }
    handleMenuClose();
  };

  const handleSelectAndClose = (roomId: string) => {
    selectRoom(roomId);
    onClose();
  };

  const handleCreateNew = () => {
    createRoom();
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle sx={{ pb: 1 }}>
        <Box display="flex" alignItems="center" justifyContent="space-between">
          <Typography variant="h6">Manage Rooms</Typography>
          <Tooltip title="New Room">
            <IconButton size="small" onClick={handleCreateNew}>
              <AddIcon />
            </IconButton>
          </Tooltip>
        </Box>
        <Typography variant="body2" color="text.secondary">
          {rooms.length} room{rooms.length !== 1 ? "s" : ""} in {activeWorkspace.name}
        </Typography>
      </DialogTitle>
      <DialogContent sx={{ p: 0 }}>
        <List dense>
          {rooms.map((room) => {
            const isActive = room.id === activeRoomId;
            const isEditing = editingId === room.id;

            return (
              <ListItem
                key={room.id}
                disablePadding
                secondaryAction={
                  !isEditing && (
                    <IconButton
                      edge="end"
                      size="small"
                      onClick={(e) => handleMenuOpen(e, room.id)}
                    >
                      <MoreVertIcon fontSize="small" />
                    </IconButton>
                  )
                }
                sx={{
                  bgcolor: isActive ? "action.selected" : "transparent",
                }}
              >
                {isEditing ? (
                  <Box display="flex" alignItems="center" gap={1} px={2} py={0.5} width="100%">
                    <DashboardIcon color="action" fontSize="small" />
                    <TextField
                      size="small"
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      onKeyDown={handleKeyDown}
                      onBlur={handleSaveEdit}
                      autoFocus
                      fullWidth
                      sx={{ "& .MuiInputBase-input": { py: 0.5 } }}
                    />
                    <IconButton size="small" onClick={handleSaveEdit}>
                      <CheckIcon fontSize="small" />
                    </IconButton>
                  </Box>
                ) : (
                  <ListItemButton
                    onClick={() => handleSelectAndClose(room.id)}
                    onDoubleClick={() => handleStartEdit(room)}
                  >
                    <ListItemIcon sx={{ minWidth: 36 }}>
                      <DashboardIcon color={isActive ? "primary" : "action"} fontSize="small" />
                    </ListItemIcon>
                    <ListItemText
                      primary={room.name}
                      secondary={`${room.panes.length} pane${room.panes.length !== 1 ? "s" : ""}`}
                      primaryTypographyProps={{
                        fontWeight: isActive ? 600 : 400,
                        color: isActive ? "primary" : "text.primary",
                      }}
                    />
                    {isActive && (
                      <Typography variant="caption" color="primary" sx={{ mr: 1 }}>
                        Active
                      </Typography>
                    )}
                  </ListItemButton>
                )}
              </ListItem>
            );
          })}
        </List>

        {/* Context Menu */}
        <Menu
          anchorEl={menuAnchor}
          open={Boolean(menuAnchor)}
          onClose={handleMenuClose}
          anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
          transformOrigin={{ vertical: "top", horizontal: "right" }}
        >
          <MenuItem onClick={handleRename}>
            <ListItemIcon>
              <EditIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText>Rename</ListItemText>
          </MenuItem>
          <MenuItem onClick={handleDuplicate}>
            <ListItemIcon>
              <ContentCopyIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText>Duplicate</ListItemText>
          </MenuItem>
          <Divider />
          <MenuItem
            onClick={handleDelete}
            disabled={rooms.length <= 1}
            sx={{ color: rooms.length > 1 ? "error.main" : undefined }}
          >
            <ListItemIcon>
              <DeleteIcon fontSize="small" color={rooms.length > 1 ? "error" : "disabled"} />
            </ListItemIcon>
            <ListItemText>Delete</ListItemText>
          </MenuItem>
        </Menu>
      </DialogContent>
      <DialogActions sx={{ px: 2, py: 1.5 }}>
        <Button onClick={onClose} size="small">
          Close
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default RoomManagerDialog;

