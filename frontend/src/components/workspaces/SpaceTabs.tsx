import React from "react";
import { Box, IconButton, Tab, Tabs, Tooltip, Typography, Button } from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import ArticleIcon from "@mui/icons-material/Article";
import TerminalIcon from "@mui/icons-material/Terminal";
import ChatIcon from "@mui/icons-material/Chat";
import BuildCircleIcon from "@mui/icons-material/BuildCircle";
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

const panesWithIcons = (pane: SpacePane) => {
  const icon = iconForPane(pane);
  return (
    <Box display="flex" alignItems="center" gap={0.5}>
      {icon}
      <Typography variant="body2" noWrap>
        {pane.title}
      </Typography>
    </Box>
  );
};

const ClosableLabel: React.FC<{ title: React.ReactNode; onClose: () => void }> = ({ title, onClose }) => (
  <Box display="flex" alignItems="center" gap={0.5}>
    {title}
    <Tooltip title="Close">
      <span>
        <IconButton
          component="span"
          size="small"
          onClick={(event) => {
            event.stopPropagation();
            onClose();
          }}
        >
          <CloseIcon fontSize="inherit" />
        </IconButton>
      </span>
    </Tooltip>
  </Box>
);

interface SpaceTabsProps {
  onToggleChatHistory?: () => void;
  chatHistoryOpen?: boolean;
}

const SpaceTabs: React.FC<SpaceTabsProps> = ({ onToggleChatHistory, chatHistoryOpen }) => {
  const { activeSpace, setActivePane, closePane } = useWorkspaces();
  if (!activeSpace) return null;
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
        value={activeSpace.activePaneId}
        onChange={(_, paneId) => setActivePane(paneId)}
        variant="scrollable"
        scrollButtons={false}
        sx={{ flex: 1, minHeight: 42 }}
        TabIndicatorProps={{ style: { height: 3 } }}
      >
        {activeSpace.panes.map((pane) => (
          <Tab
            key={pane.id}
            value={pane.id}
            label={
              pane.kind === "chat"
                ? panesWithIcons(pane)
                : <ClosableLabel title={panesWithIcons(pane)} onClose={() => closePane(pane.id)} />
            }
          />
        ))}
      </Tabs>
      {onToggleChatHistory && (
        <Button size="small" onClick={onToggleChatHistory}>
          {chatHistoryOpen ? "Hide History" : "History"}
        </Button>
      )}
    </Box>
  );
};

export default SpaceTabs;
