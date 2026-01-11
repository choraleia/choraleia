import React, { FC } from "react";
import {
  ThreadListItemPrimitive,
  ThreadListPrimitive,
  useAssistantState,
} from "@assistant-ui/react";
import { DeleteIcon } from "./icons";
import {
  Box,
  Typography,
  IconButton,
  List,
  ListItem,
  ListItemButton,
  Skeleton as MUISkeleton,
} from "@mui/material";

export const ThreadList: FC = () => {
  const isLoading = useAssistantState(
    ({ threads }) => threads.isLoading,
  );
  const threadItems = useAssistantState(
    ({ threads }) => threads.threadItems || [],
  );

  return (
    <Box
      sx={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        overflow: "hidden",
      }}
    >
      {/* Conversation list */}
      <Box sx={{ flex: 1, overflowY: "auto" }}>
        {isLoading ? (
          <Box sx={{ p: 1 }}>
            <ThreadListSkeleton />
          </Box>
        ) : threadItems.length === 0 ? (
          <Box sx={{ px: 2, py: 3, textAlign: "center" }}>
            <Typography variant="body2" color="text.secondary">
              No conversations yet
            </Typography>
          </Box>
        ) : (
          <List dense disablePadding sx={{ py: 0.5 }}>
            <ThreadListPrimitive.Items
              components={{
                ThreadListItem: ThreadListItem,
              }}
            />
          </List>
        )}
      </Box>
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

const ThreadListItem: FC<{ id?: string }> = ({ id }) => {
  const mainThreadId = useAssistantState(({ threads }) => threads.mainThreadId);
  const isActive = id === mainThreadId;
  return (
    <ThreadListItemPrimitive.Root>
      <ListItem disablePadding>
        <ThreadListItemPrimitive.Trigger asChild>
          <ListItemButton
            selected={isActive}
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

