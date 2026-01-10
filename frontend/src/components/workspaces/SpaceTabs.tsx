import React, { useState, useCallback, useEffect } from "react";
import { Box, IconButton, Tab, Tabs, Tooltip, Typography, Menu, MenuItem, ListItemIcon, ListItemText } from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import ArticleIcon from "@mui/icons-material/Article";
import TerminalIcon from "@mui/icons-material/Terminal";
import ChatIcon from "@mui/icons-material/Chat";
import BuildCircleIcon from "@mui/icons-material/BuildCircle";
import SaveIcon from "@mui/icons-material/Save";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import CloseOtherIcon from "@mui/icons-material/ClearAll";
import CloseAllIcon from "@mui/icons-material/Close";
import FiberManualRecordIcon from "@mui/icons-material/FiberManualRecord";
import { SpacePane, useWorkspaces } from "../../state/workspaces";

const iconForPane = (pane: SpacePane) => {
  switch (pane.kind) {
    case "chat":
      return <ChatIcon fontSize="small" />;
    case "editor":
      return <ArticleIcon fontSize="small" />;
    case "tool":
      return <BuildCircleIcon fontSize="small" />;
    default:
      return <TerminalIcon fontSize="small" />;
  }
};

const PaneLabel: React.FC<{ pane: SpacePane }> = ({ pane }) => {
  const icon = iconForPane(pane);
  const isDirty = pane.kind === "editor" && pane.dirty;
  return (
    <Box display="flex" alignItems="center" gap={0.5}>
      {icon}
      <Typography variant="body2" noWrap>
        {pane.title}
      </Typography>
      {isDirty && (
        <FiberManualRecordIcon
          sx={{
            fontSize: 8,
            color: "warning.main",
            ml: 0.5
          }}
        />
      )}
    </Box>
  );
};

const ClosableLabel: React.FC<{ pane: SpacePane; onClose: () => void }> = ({ pane, onClose }) => (
  <Box display="flex" alignItems="center" gap={0.5}>
    <PaneLabel pane={pane} />
    <Tooltip title="Close">
      <span>
        <IconButton
          component="span"
          size="small"
          onClick={(event) => {
            event.stopPropagation();
            onClose();
          }}
          sx={{ ml: 0.5 }}
        >
          <CloseIcon fontSize="inherit" />
        </IconButton>
      </span>
    </Tooltip>
  </Box>
);

interface ContextMenuState {
  mouseX: number;
  mouseY: number;
  paneId: string;
}

const SpaceTabs: React.FC = () => {
  const { activeRoom, setActivePane, closePane, saveEditorContent } = useWorkspaces();
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);

  // Handle Ctrl+S to save current editor
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "s") {
        e.preventDefault();
        if (activeRoom) {
          const currentPane = activeRoom.panes.find((p) => p.id === activeRoom.activePaneId);
          if (currentPane?.kind === "editor" && currentPane.dirty) {
            saveEditorContent(currentPane.id);
          }
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [activeRoom, saveEditorContent]);

  const handleContextMenu = useCallback((event: React.MouseEvent, paneId: string) => {
    event.preventDefault();
    event.stopPropagation();
    setContextMenu({ mouseX: event.clientX, mouseY: event.clientY, paneId });
  }, []);

  const handleCloseContextMenu = useCallback(() => {
    setContextMenu(null);
  }, []);

  const handleSave = useCallback(() => {
    if (contextMenu) {
      saveEditorContent(contextMenu.paneId);
    }
    handleCloseContextMenu();
  }, [contextMenu, saveEditorContent, handleCloseContextMenu]);

  const handleClose = useCallback(() => {
    if (contextMenu) {
      closePane(contextMenu.paneId);
    }
    handleCloseContextMenu();
  }, [contextMenu, closePane, handleCloseContextMenu]);

  const handleCloseOthers = useCallback(() => {
    if (contextMenu && activeRoom) {
      activeRoom.panes.forEach((pane) => {
        if (pane.id !== contextMenu.paneId && pane.kind !== "chat") {
          closePane(pane.id);
        }
      });
    }
    handleCloseContextMenu();
  }, [contextMenu, activeRoom, closePane, handleCloseContextMenu]);

  const handleCloseAll = useCallback(() => {
    if (activeRoom) {
      activeRoom.panes.forEach((pane) => {
        if (pane.kind !== "chat") {
          closePane(pane.id);
        }
      });
    }
    handleCloseContextMenu();
  }, [activeRoom, closePane, handleCloseContextMenu]);

  const handleCopyPath = useCallback(() => {
    if (contextMenu && activeRoom) {
      const pane = activeRoom.panes.find((p) => p.id === contextMenu.paneId);
      if (pane?.kind === "editor") {
        navigator.clipboard.writeText(pane.filePath);
      }
    }
    handleCloseContextMenu();
  }, [contextMenu, activeRoom, handleCloseContextMenu]);

  if (!activeRoom) return null;

  const contextPane = contextMenu ? activeRoom.panes.find((p) => p.id === contextMenu.paneId) : null;
  const isEditorPane = contextPane?.kind === "editor";
  const isEditorDirty = isEditorPane && contextPane.dirty;

  return (
    <Box
      display="flex"
      alignItems="center"
      borderBottom={(theme) => `1px solid ${theme.palette.divider}`}
      minHeight={42}
      px={1}
      gap={1}
    >
      <Tabs
        value={activeRoom.activePaneId}
        onChange={(_, paneId) => setActivePane(paneId)}
        variant="scrollable"
        scrollButtons={false}
        sx={{ flex: 1, minHeight: 42 }}
        TabIndicatorProps={{ style: { height: 3 } }}
      >
        {activeRoom.panes.map((pane) => (
          <Tab
            key={pane.id}
            value={pane.id}
            onContextMenu={(e) => handleContextMenu(e, pane.id)}
            label={
              pane.kind === "chat"
                ? <PaneLabel pane={pane} />
                : <ClosableLabel pane={pane} onClose={() => closePane(pane.id)} />
            }
          />
        ))}
      </Tabs>

      {/* Context Menu */}
      <Menu
        open={contextMenu !== null}
        onClose={handleCloseContextMenu}
        anchorReference="anchorPosition"
        anchorPosition={
          contextMenu !== null
            ? { top: contextMenu.mouseY, left: contextMenu.mouseX }
            : undefined
        }
      >
        {isEditorPane && (
          <MenuItem onClick={handleSave} disabled={!isEditorDirty}>
            <ListItemIcon>
              <SaveIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText primaryTypographyProps={{ variant: "body2" }}>Save</ListItemText>
          </MenuItem>
        )}
        {isEditorPane && (
          <MenuItem onClick={handleCopyPath}>
            <ListItemIcon>
              <ContentCopyIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText primaryTypographyProps={{ variant: "body2" }}>Copy Path</ListItemText>
          </MenuItem>
        )}
        {contextPane?.kind !== "chat" && (
          <MenuItem onClick={handleClose}>
            <ListItemIcon>
              <CloseIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText primaryTypographyProps={{ variant: "body2" }}>Close</ListItemText>
          </MenuItem>
        )}
        <MenuItem onClick={handleCloseOthers}>
          <ListItemIcon>
            <CloseOtherIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText primaryTypographyProps={{ variant: "body2" }}>Close Others</ListItemText>
        </MenuItem>
        <MenuItem onClick={handleCloseAll}>
          <ListItemIcon>
            <CloseAllIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText primaryTypographyProps={{ variant: "body2" }}>Close All</ListItemText>
        </MenuItem>
      </Menu>
    </Box>
  );
};

export default SpaceTabs;
