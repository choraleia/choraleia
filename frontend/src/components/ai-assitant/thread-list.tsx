import React, { FC, useState } from "react";
import {
  ThreadListItemPrimitive,
  ThreadListPrimitive,
  useAssistantState,
} from "@assistant-ui/react";
import { AddIcon, DeleteIcon } from "./assistant-icons";
import {
  Box,
  Typography,
  IconButton,
  Menu,
  List,
  ListItem,
  ListItemButton,
  Skeleton as MUISkeleton,
} from "@mui/material";

export const ThreadList: FC = () => {
  // Get current conversation title
  const currentThreadTitle = useAssistantState(({ threads }) => {
    const mainId = threads.mainThreadId;
    const thread = threads.threadItems?.find(
      (item) => item.id === mainId && item.id !== "DEFAULT_THREAD_ID",
    );
    return thread ? thread.title : "New Conversation";
  });
  const isLoading = useAssistantState(({ threads }) => threads.isLoading);
  const threadItems = useAssistantState(
    ({ threads }) => threads.threadItems || [],
  );

  const [menuAnchor, setMenuAnchor] = useState<null | HTMLElement>(null);
  const menuOpen = Boolean(menuAnchor);

  const handleOpenMenu = (e: React.MouseEvent<HTMLElement>) =>
    setMenuAnchor(e.currentTarget);
  const handleCloseMenu = () => setMenuAnchor(null);
  const handleSelectThread = () => handleCloseMenu();

  return (
    <Box
      component="header"
      sx={{
        px: 1.5,
        py: 1,
        borderBottom: "1px solid",
        borderColor: "divider",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        flexShrink: 0,
      }}
    >
      <Typography
        variant="subtitle2"
        noWrap
        sx={{ userSelect: "none", fontWeight: 500 }}
      >
        {currentThreadTitle}
      </Typography>
      <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
        {/* Conversation history button */}
        <IconButton
          size="small"
          onClick={handleOpenMenu}
          aria-label="Conversation History"
          title="Conversation History"
        >
          {/* Simple clock/history icon using current DeleteIcon path fallback if needed */}
          <svg
            width={18}
            height={18}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="12" cy="12" r="9" />
            <polyline points="12 7 12 12 16 14" />
          </svg>
        </IconButton>
        {/* New conversation button */}
        <ThreadListPrimitive.New asChild>
          <IconButton
            size="small"
            aria-label="New Conversation"
            title="New Conversation"
          >
            <AddIcon />
          </IconButton>
        </ThreadListPrimitive.New>
      </Box>
      {/* Dropdown menu for conversation history */}
      <Menu
        anchorEl={menuAnchor}
        open={menuOpen}
        onClose={handleCloseMenu}
        anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
        transformOrigin={{ vertical: "top", horizontal: "right" }}
        slotProps={{
          paper: {
            sx: { width: 300, maxHeight: 320, overflowY: "auto", p: 0 },
          },
        }}
      >
        <Box sx={{ width: "100%" }}>
          {isLoading ? (
            <Box sx={{ p: 1 }}>
              <ThreadListSkeleton />
            </Box>
          ) : threadItems.length === 0 ? (
            <Box sx={{ px: 2, py: 1.5 }}>
              <Typography variant="body2" color="text.secondary">
                No conversation history
              </Typography>
            </Box>
          ) : (
            <List dense disablePadding sx={{ py: 0 }}>
              <ThreadListPrimitive.Items
                components={{
                  ThreadListItem: (props) => (
                    <ThreadListItem {...props} onSelect={handleSelectThread} />
                  ),
                }}
              />
            </List>
          )}
        </Box>
      </Menu>
    </Box>
  );
};

const ThreadListSkeleton: FC = () => (
  <Box>
    {Array.from({ length: 5 }).map((_, i) => (
      <Box
        key={i}
        sx={{
          display: "flex",
          alignItems: "center",
          gap: 1,
          px: 1.5,
          py: 0.75,
        }}
      >
        <MUISkeleton variant="text" width="100%" height={22} />
      </Box>
    ))}
  </Box>
);

const ThreadListItem: FC<{ id?: string; onSelect?: () => void }> = ({
  id,
  onSelect,
}) => {
  const mainThreadId = useAssistantState(({ threads }) => threads.mainThreadId);
  const isActive = id === mainThreadId;
  return (
    <ThreadListItemPrimitive.Root>
      <ListItem disablePadding>
        <ThreadListItemPrimitive.Trigger asChild>
          <ListItemButton
            selected={isActive}
            onClick={onSelect}
            sx={{
              py: 0.75,
              px: 1.5,
              "&.Mui-selected": { bgcolor: "action.selected", fontWeight: 500 },
              display: "flex",
              alignItems: "center",
              justifyContent: "flex-start",
              gap: 1,
              textAlign: "left",
              position: "relative",
              "& .thread-delete-btn": {
                opacity: 0,
                pointerEvents: "none",
                transition: "opacity 0.15s",
              },
              "&:hover .thread-delete-btn": {
                opacity: 1,
                pointerEvents: "auto",
              },
            }}
          >
            <ThreadListItemTitle />
            <ThreadListItemDelete />
          </ListItemButton>
        </ThreadListItemPrimitive.Trigger>
      </ListItem>
    </ThreadListItemPrimitive.Root>
  );
};

const ThreadListItemTitle: FC = () => (
  <Typography
    variant="body2"
    noWrap
    sx={{ fontSize: 13, width: "100%", textAlign: "left" }}
  >
    <ThreadListItemPrimitive.Title fallback="New Conversation" />
  </Typography>
);

// Adjust delete button styling for MUI
const ThreadListItemDelete: FC = () => (
  <ThreadListItemPrimitive.Delete asChild>
    <IconButton
      size="small"
      aria-label="Delete Conversation"
      title="Delete Conversation"
      className="thread-delete-btn"
      onClick={(e) => e.stopPropagation()}
      sx={{ color: "error.main" }}
    >
      <DeleteIcon />
    </IconButton>
  </ThreadListItemPrimitive.Delete>
);
