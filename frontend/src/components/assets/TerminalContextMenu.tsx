// filepath: /home/blue/codes/choraleia/frontend/src/components/assets/TerminalContextMenu.tsx
import React from "react";
import {
  Menu,
  MenuItem,
  ListItemIcon,
  ListItemText,
  Divider,
  Typography,
} from "@mui/material";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import ContentPasteIcon from "@mui/icons-material/ContentPaste";
import SelectAllIcon from "@mui/icons-material/SelectAll";
import ClearAllIcon from "@mui/icons-material/ClearAll";
import SearchIcon from "@mui/icons-material/Search";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import TerminalIcon from "@mui/icons-material/Terminal";
import SaveAltIcon from "@mui/icons-material/SaveAlt";
import RefreshIcon from "@mui/icons-material/Refresh";
import VerticalAlignBottomIcon from "@mui/icons-material/VerticalAlignBottom";

export interface TerminalContextMenuProps {
  anchorPosition: { top: number; left: number } | null;
  onClose: () => void;
  // Terminal operations
  onCopy: () => void;
  onPaste: () => void;
  onSelectAll: () => void;
  onClear: () => void;
  onScrollToBottom: () => void;
  // Search
  onSearch?: () => void;
  // Quick commands
  onOpenQuickCommands?: () => void;
  // Session operations
  onReconnect?: () => void;
  onDuplicateSession?: () => void;
  // Export
  onExportOutput?: () => void;
  // State
  hasSelection?: boolean;
  isConnected?: boolean;
}

const TerminalContextMenu: React.FC<TerminalContextMenuProps> = ({
  anchorPosition,
  onClose,
  onCopy,
  onPaste,
  onSelectAll,
  onClear,
  onScrollToBottom,
  onSearch,
  onOpenQuickCommands,
  onReconnect,
  onDuplicateSession,
  onExportOutput,
  hasSelection = false,
  isConnected = true,
}) => {
  const handleAction = (action: () => void) => {
    action();
    onClose();
  };

  return (
    <Menu
      open={anchorPosition !== null}
      onClose={onClose}
      anchorReference="anchorPosition"
      anchorPosition={anchorPosition ?? undefined}
      slotProps={{
        paper: {
          sx: {
            minWidth: 180,
            "& .MuiMenuItem-root": {
              py: 0.5,
              px: 1.25,
              fontSize: 12,
              minHeight: 24,
            },
            "& .MuiListItemIcon-root": {
              minWidth: 24,
            },
            "& .MuiSvgIcon-root": {
              fontSize: 16,
            },
            "& .MuiListItemText-primary": {
              fontSize: 12,
            },
          },
        },
      }}
    >
      {/* Clipboard Operations */}
      <MenuItem onClick={() => handleAction(onCopy)} disabled={!hasSelection}>
        <ListItemIcon>
          <ContentCopyIcon />
        </ListItemIcon>
        <ListItemText>Copy</ListItemText>
        <Typography variant="body2" color="text.secondary" sx={{ ml: 2, fontSize: 10 }}>
          Ctrl+Shift+C
        </Typography>
      </MenuItem>
      <MenuItem onClick={() => handleAction(onPaste)}>
        <ListItemIcon>
          <ContentPasteIcon />
        </ListItemIcon>
        <ListItemText>Paste</ListItemText>
        <Typography variant="body2" color="text.secondary" sx={{ ml: 2, fontSize: 10 }}>
          Ctrl+Shift+V
        </Typography>
      </MenuItem>

      <Divider sx={{ my: 0.5 }} />

      {/* Selection & View */}
      <MenuItem onClick={() => handleAction(onSelectAll)}>
        <ListItemIcon>
          <SelectAllIcon />
        </ListItemIcon>
        <ListItemText>Select All</ListItemText>
      </MenuItem>
      <MenuItem onClick={() => handleAction(onClear)}>
        <ListItemIcon>
          <ClearAllIcon />
        </ListItemIcon>
        <ListItemText>Clear Terminal</ListItemText>
      </MenuItem>
      <MenuItem onClick={() => handleAction(onScrollToBottom)}>
        <ListItemIcon>
          <VerticalAlignBottomIcon />
        </ListItemIcon>
        <ListItemText>Scroll to Bottom</ListItemText>
      </MenuItem>

      {onSearch && (
        <>
          <Divider sx={{ my: 0.5 }} />
          <MenuItem onClick={() => handleAction(onSearch)}>
            <ListItemIcon>
              <SearchIcon />
            </ListItemIcon>
            <ListItemText>Find...</ListItemText>
            <Typography variant="body2" color="text.secondary" sx={{ ml: 2, fontSize: 10 }}>
              Ctrl+Shift+F
            </Typography>
          </MenuItem>
        </>
      )}

      {onOpenQuickCommands && (
        <>
          <Divider sx={{ my: 0.5 }} />
          <MenuItem onClick={() => handleAction(onOpenQuickCommands)}>
            <ListItemIcon>
              <TerminalIcon />
            </ListItemIcon>
            <ListItemText>Quick Commands</ListItemText>
          </MenuItem>
        </>
      )}

      <Divider sx={{ my: 0.5 }} />

      {/* Session Operations */}
      {onReconnect && (
        <MenuItem onClick={() => handleAction(onReconnect)} disabled={isConnected}>
          <ListItemIcon>
            <RefreshIcon />
          </ListItemIcon>
          <ListItemText>Reconnect</ListItemText>
        </MenuItem>
      )}
      {onDuplicateSession && (
        <MenuItem onClick={() => handleAction(onDuplicateSession)}>
          <ListItemIcon>
            <OpenInNewIcon />
          </ListItemIcon>
          <ListItemText>Duplicate Session</ListItemText>
        </MenuItem>
      )}

      {onExportOutput && (
        <>
          <Divider sx={{ my: 0.5 }} />
          <MenuItem onClick={() => handleAction(onExportOutput)}>
            <ListItemIcon>
              <SaveAltIcon />
            </ListItemIcon>
            <ListItemText>Export Output...</ListItemText>
          </MenuItem>
        </>
      )}
    </Menu>
  );
};

export default TerminalContextMenu;

