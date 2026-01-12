import React, { useState, useCallback } from "react";
import {
  Box,
  IconButton,
  Tabs,
  Tab,
  Menu,
  MenuItem,
  Divider,
  ListItemIcon,
  ListItemText,
  Tooltip,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import CloseIcon from "@mui/icons-material/Close";
import TerminalIcon from "@mui/icons-material/Terminal";
import DescriptionIcon from "@mui/icons-material/Description";
import WebIcon from "@mui/icons-material/Web";
import CircleIcon from "@mui/icons-material/Circle";
import VerticalSplitIcon from "@mui/icons-material/VerticalSplit";
import HorizontalSplitIcon from "@mui/icons-material/HorizontalSplit";
import { TabItem, SplitDirection } from "../../../state/workspaces";

interface TabBarProps {
  tabs: TabItem[];
  activeTabId: string;
  isActivePane: boolean;
  onTabChange: (tabId: string) => void;
  onCloseTab: (tabId: string) => void;
  onSplitPane: (tabId: string, direction: SplitDirection) => void;
  onAddTerminal?: () => void;
}

export const TabBar: React.FC<TabBarProps> = ({
  tabs,
  activeTabId,
  isActivePane,
  onTabChange,
  onCloseTab,
  onSplitPane,
  onAddTerminal,
}) => {
  // Context menu state
  const [contextMenu, setContextMenu] = useState<{
    mouseX: number;
    mouseY: number;
    tabId: string;
  } | null>(null);

  const handleContextMenu = useCallback((event: React.MouseEvent, tabId: string) => {
    event.preventDefault();
    event.stopPropagation();
    setContextMenu({
      mouseX: event.clientX,
      mouseY: event.clientY,
      tabId,
    });
  }, []);

  const handleCloseContextMenu = useCallback(() => {
    setContextMenu(null);
  }, []);

  const handleSplit = useCallback((direction: SplitDirection) => {
    if (contextMenu) {
      onSplitPane(contextMenu.tabId, direction);
      handleCloseContextMenu();
    }
  }, [contextMenu, onSplitPane, handleCloseContextMenu]);

  const handleCloseFromMenu = useCallback(() => {
    if (contextMenu) {
      onCloseTab(contextMenu.tabId);
      handleCloseContextMenu();
    }
  }, [contextMenu, onCloseTab, handleCloseContextMenu]);

  const getTabIcon = (type: TabItem["type"]) => {
    switch (type) {
      case "terminal": return <TerminalIcon fontSize="small" />;
      case "editor": return <DescriptionIcon fontSize="small" />;
      case "browser": return <WebIcon fontSize="small" />;
    }
  };

  const handleTabClick = useCallback((_: React.SyntheticEvent, value: string) => {
    onTabChange(value);
  }, [onTabChange]);

  const handleCloseClick = useCallback((e: React.MouseEvent, tabId: string) => {
    e.stopPropagation();
    onCloseTab(tabId);
  }, [onCloseTab]);

  return (
    <>
      <Box
        display="flex"
        alignItems="center"
        sx={{
          borderBottom: "1px solid",
          borderColor: "divider",
          height: 36,
          minHeight: 36,
          bgcolor: "background.paper",
        }}
      >
        <Tabs
          value={activeTabId || false}
          onChange={handleTabClick}
          variant="scrollable"
          scrollButtons="auto"
          sx={{
            minHeight: 36,
            flex: 1,
            "& .MuiTabs-indicator": {
              backgroundColor: isActivePane ? "primary.main" : "grey.500",
            },
            "& .MuiTab-root": {
              minHeight: 36,
              py: 0,
              px: 1.5,
              textTransform: "none",
              fontSize: 12,
            },
          }}
        >
          {tabs.map((tab) => (
            <Tab
              key={tab.id}
              value={tab.id}
              onContextMenu={(e) => handleContextMenu(e, tab.id)}
              label={
                <Box display="flex" alignItems="center" gap={0.5}>
                  {getTabIcon(tab.type)}
                  <span>{tab.title}</span>
                  {tab.dirty && (
                    <CircleIcon sx={{ fontSize: 8, color: "warning.main" }} />
                  )}
                  <CloseIcon
                    sx={{ fontSize: 14, ml: 0.5, opacity: 0.6, "&:hover": { opacity: 1 } }}
                    onClick={(e) => handleCloseClick(e, tab.id)}
                  />
                </Box>
              }
            />
          ))}
        </Tabs>
        {onAddTerminal && (
          <Tooltip title="New Terminal">
            <IconButton size="small" onClick={onAddTerminal} sx={{ mr: 1 }}>
              <AddIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        )}
      </Box>

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
        sx={{
          "& .MuiMenuItem-root": {
            fontSize: "12px",
            minHeight: "20px",
          },
          "& .MuiListItemText-primary": {
            fontSize: "12px",
          },
        }}
      >
        <MenuItem onClick={() => handleSplit("left")} disabled={tabs.length <= 1}>
          <ListItemIcon>
            <VerticalSplitIcon fontSize="small" sx={{ transform: "scaleX(-1)" }} />
          </ListItemIcon>
          <ListItemText>Split Left</ListItemText>
        </MenuItem>
        <MenuItem onClick={() => handleSplit("right")} disabled={tabs.length <= 1}>
          <ListItemIcon>
            <VerticalSplitIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>Split Right</ListItemText>
        </MenuItem>
        <MenuItem onClick={() => handleSplit("up")} disabled={tabs.length <= 1}>
          <ListItemIcon>
            <HorizontalSplitIcon fontSize="small" sx={{ transform: "scaleY(-1)" }} />
          </ListItemIcon>
          <ListItemText>Split Up</ListItemText>
        </MenuItem>
        <MenuItem onClick={() => handleSplit("down")} disabled={tabs.length <= 1}>
          <ListItemIcon>
            <HorizontalSplitIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>Split Down</ListItemText>
        </MenuItem>
        <Divider />
        <MenuItem onClick={handleCloseFromMenu}>
          <ListItemIcon>
            <CloseIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>Close Tab</ListItemText>
        </MenuItem>
      </Menu>
    </>
  );
};

