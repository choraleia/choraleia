import React, { useState } from "react";
import {
  Box,
  Button,
  Chip,
  IconButton,
  List,
  ListItem,
  ListItemButton,
  ListItemText,
  Stack,
  Tooltip,
  Typography,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Tabs,
  Tab,
  Divider,
  MenuItem,
  Select,
  TextareaAutosize,
} from "@mui/material";
import SendIcon from "@mui/icons-material/Send";
import DeleteIcon from "@mui/icons-material/Delete";
import DonutLargeIcon from "@mui/icons-material/DonutLarge";
import PlaylistAddCheckIcon from "@mui/icons-material/PlaylistAddCheck";
import AddIcon from "@mui/icons-material/Add";
import HistoryIcon from "@mui/icons-material/History";
import { styled, alpha } from "@mui/material/styles";
import { useWorkspaces, ChatSession, ToolSession } from "../../state/workspaces";

const Textarea = styled(TextareaAutosize)(({ theme }) => ({
  width: "100%",
  border: "none",
  padding: theme.spacing(0.5, 0.25),
  fontFamily: "inherit",
  fontSize: 14,
  lineHeight: 1.5,
  background: "transparent",
  color: theme.palette.text.primary,
  resize: "none",
  overflowY: "auto",
  outline: "none",
}));

const ComposerContainer = styled(Box)(({ theme }) => ({
  border: `1px solid ${theme.palette.divider}`,
  borderRadius: theme.shape.borderRadius,
  padding: theme.spacing(1),
  background: theme.palette.background.paper,
  display: "flex",
  flexDirection: "column",
  gap: theme.spacing(1),
  transition: theme.transitions.create(["border-color", "box-shadow"], {
    duration: theme.transitions.duration.shorter,
  }),
  "&:focus-within": {
    borderColor: theme.palette.primary.main,
    boxShadow: `0 0 0 1px ${alpha(theme.palette.primary.main, 0.2)}`,
  },
}));

const ChatSessionList: React.FC<{
  sessions: ChatSession[];
  activeSessionId: string;
  onSelect: (sessionId: string) => void;
  onDelete: (sessionId: string) => void;
}> = ({ sessions, activeSessionId, onSelect, onDelete }) => (
  <Box width="100%" display="flex" flexDirection="column" height="100%">
    <List dense sx={{ flex: 1, overflow: "auto", py: 0 }}>
      {sessions.map((session) => (
        <ListItem
          disablePadding
          key={session.id}
          secondaryAction={
            sessions.length > 1 && (
              <Tooltip title="Delete">
                <IconButton
                  edge="end"
                  size="small"
                  onClick={(event) => {
                    event.stopPropagation();
                    onDelete(session.id);
                  }}
                >
                  <DeleteIcon fontSize="inherit" />
                </IconButton>
              </Tooltip>
            )
          }
        >
          <ListItemButton
            selected={session.id === activeSessionId}
            onClick={() => onSelect(session.id)}
          >
            <ListItemText
              primary={session.title}
              secondary={`Updated ${new Date(session.updatedAt).toLocaleTimeString()}`}
            />
          </ListItemButton>
        </ListItem>
      ))}
    </List>
  </Box>
);

const ActiveToolsDialog: React.FC<{
  tools: ToolSession[];
  open: boolean;
  onClose: () => void;
}> = ({ tools, open, onClose }) => {
  const [selectedTab, setSelectedTab] = React.useState<string>(tools[0]?.id ?? "");

  React.useEffect(() => {
    if (!tools.length) {
      setSelectedTab("");
      return;
    }
    setSelectedTab((prev) =>
      tools.some((tool) => tool.id === prev) ? prev : tools[0].id
    );
  }, [tools]);

  const activeTool = tools.find((tool) => tool.id === selectedTab);
  const statusColor: Record<ToolSession["status"], "default" | "success" | "error" | "warning"> = {
    running: "success",
    idle: "default",
    error: "error",
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      fullWidth
      maxWidth="md"
    >
      <DialogTitle>Active Tools</DialogTitle>
      <DialogContent dividers>
        {tools.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            No active tools in this session.
          </Typography>
        ) : (
          <Box>
            <Tabs
              value={selectedTab}
              onChange={(_event, value) => setSelectedTab(value)}
              variant="scrollable"
              scrollButtons="auto"
              sx={{ borderBottom: 1, borderColor: "divider" }}
            >
              {tools.map((tool) => (
                <Tab
                  key={tool.id}
                  value={tool.id}
                  label={
                    <Stack alignItems="flex-start" spacing={0.25}>
                      <Typography variant="subtitle2">{tool.label}</Typography>
                      <Chip
                        size="small"
                        label={tool.status}
                        color={statusColor[tool.status]}
                        sx={{ height: 20 }}
                      />
                    </Stack>
                  }
                />
              ))}
            </Tabs>
            <Box p={2}>
              {activeTool && (
                <Stack spacing={2}>
                  <Stack direction="row" spacing={2} alignItems="center">
                    <Typography variant="h6">{activeTool.label}</Typography>
                    <Chip
                      label={activeTool.status === "running" ? "Live" : activeTool.status}
                      color={statusColor[activeTool.status]}
                      size="small"
                    />
                  </Stack>
                  {activeTool.summary && (
                    <Typography variant="body2" color="text.secondary">
                      {activeTool.summary}
                    </Typography>
                  )}
                </Stack>
              )}
            </Box>
          </Box>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
};

interface ChatPanelProps {
  compact?: boolean;  // Compact mode for sidebar use
}

const ChatPanel: React.FC<ChatPanelProps> = ({ compact = false }) => {
  const {
    activeRoom,
    sendChatMessage,
    setActiveChatSession,
    createChatSession,
    deleteChatSession,
  } = useWorkspaces();

  const [activeToolsDialogOpen, setActiveToolsDialogOpen] = useState(false);
  const [chatHistoryOpen, setChatHistoryOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [agentMode, setAgentMode] = useState("agents");
  const [modelChoice, setModelChoice] = useState("gpt-4o-mini");

  if (!activeRoom) return null;

  const chatPane = activeRoom.panes.find((p) => p.kind === "chat");
  if (!chatPane || chatPane.kind !== "chat" || !chatPane.sessions?.length) return null;

  const activeSession =
    chatPane.sessions.find((s) => s.id === chatPane.activeSessionId) || chatPane.sessions[0];
  const activeTools = activeSession?.activeTools ?? [];
  const historyWidth = compact ? 200 : 280;

  const handleSend = () => {
    if (draft.trim()) {
      sendChatMessage(chatPane.id, draft);
      setDraft("");
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <Box display="flex" height="100%" flexDirection="column">
      {/* Header - only show in non-compact mode */}
      {!compact && (
        <Box
          px={2}
          py={1}
          borderBottom={(theme) => `1px solid ${theme.palette.divider}`}
          display="flex"
          alignItems="center"
          gap={1}
        >
          <Typography variant="subtitle2" color="text.secondary" flex={1}>
            AI Assistant
          </Typography>
          {activeTools.length > 0 ? (
            <Button
              size="small"
              variant="outlined"
              startIcon={<PlaylistAddCheckIcon fontSize="small" />}
              onClick={() => setActiveToolsDialogOpen(true)}
            >
              Tools ({activeTools.length})
            </Button>
          ) : (
            <Chip
              label="No active tools"
              size="small"
              variant="outlined"
              icon={<DonutLargeIcon fontSize="small" />}
            />
          )}
          <Button
            size="small"
            variant="outlined"
            onClick={() => createChatSession(chatPane.id)}
          >
            New
          </Button>
          <Button
            size="small"
            variant={chatHistoryOpen ? "contained" : "outlined"}
            onClick={() => setChatHistoryOpen(!chatHistoryOpen)}
          >
            History
          </Button>
        </Box>
      )}

      {/* Compact header for sidebar mode */}
      {compact && (
        <Box
          px={1}
          py={0.5}
          borderBottom={(theme) => `1px solid ${theme.palette.divider}`}
          display="flex"
          alignItems="center"
          gap={0.5}
        >
          <Box flex={1} />
          {activeTools.length > 0 && (
            <Tooltip title={`${activeTools.length} active tools`}>
              <IconButton size="small" onClick={() => setActiveToolsDialogOpen(true)}>
                <PlaylistAddCheckIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          )}
          <Tooltip title="New Chat">
            <IconButton size="small" onClick={() => createChatSession(chatPane.id)}>
              <AddIcon fontSize="small" />
            </IconButton>
          </Tooltip>
          <Tooltip title="History">
            <IconButton
              size="small"
              onClick={() => setChatHistoryOpen(!chatHistoryOpen)}
              color={chatHistoryOpen ? "primary" : "default"}
            >
              <HistoryIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        </Box>
      )}

      {/* Content */}
      <Box display="flex" flex={1} minHeight={0}>
        {/* Messages */}
        <Box flex={1} display="flex" flexDirection="column" minHeight={0}>
          <Box
            flex={1}
            overflow="auto"
            px={2}
            py={1.5}
            display="flex"
            flexDirection="column"
            justifyContent="flex-end"
          >
            {activeSession?.messages.map((msg) => (
              <Box
                key={msg.id}
                display="flex"
                justifyContent={msg.role === "user" ? "flex-end" : "flex-start"}
                width="100%"
                sx={{ mb: 1.5 }}
              >
                <Box
                  display="flex"
                  flexDirection="column"
                  alignItems={msg.role === "user" ? "flex-end" : "flex-start"}
                  maxWidth="85%"
                >
                  <Chip
                    label={msg.role === "user" ? "You" : "AI Agent"}
                    size="small"
                    color={msg.role === "user" ? "default" : "primary"}
                  />
                  <Box
                    mt={0.5}
                    p={1.5}
                    borderRadius={2}
                    bgcolor={msg.role === "user" ? "background.paper" : "action.hover"}
                    border={(theme) => `1px solid ${theme.palette.divider}`}
                  >
                    <Typography variant="body2" whiteSpace="pre-wrap">
                      {msg.content}
                    </Typography>
                  </Box>
                </Box>
              </Box>
            ))}
          </Box>

          {/* Input */}
          <Box px={2} pb={2}>
            <ComposerContainer>
              <Textarea
                minRows={2}
                maxRows={6}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Ask AI to run commands, edit files, or explain code..."
              />
              <Stack direction="row" alignItems="center" spacing={0.5}>
                <Select
                  size="small"
                  value={agentMode}
                  onChange={(e) => setAgentMode(e.target.value)}
                  sx={{
                    "& .MuiOutlinedInput-notchedOutline": { border: 0 },
                    fontSize: 12,
                  }}
                >
                  <MenuItem value="agents">Autonomous</MenuItem>
                  <MenuItem value="assistant">Assistant</MenuItem>
                </Select>
                <Select
                  size="small"
                  value={modelChoice}
                  onChange={(e) => setModelChoice(e.target.value)}
                  sx={{
                    "& .MuiOutlinedInput-notchedOutline": { border: 0 },
                    fontSize: 12,
                  }}
                >
                  <MenuItem value="gpt-4o-mini">GPT-4o mini</MenuItem>
                  <MenuItem value="claude-3.5">Claude 3.5</MenuItem>
                  <MenuItem value="local-mixtral">Local Mixtral</MenuItem>
                </Select>
                <Box flex={1} />
                <IconButton
                  color="primary"
                  onClick={handleSend}
                  disabled={!draft.trim()}
                >
                  <SendIcon fontSize="small" />
                </IconButton>
              </Stack>
            </ComposerContainer>
          </Box>
        </Box>

        {/* History Sidebar */}
        {chatHistoryOpen && (
          <>
            <Divider orientation="vertical" flexItem />
            <Box width={historyWidth} overflow="auto">
              <ChatSessionList
                sessions={chatPane.sessions}
                activeSessionId={activeSession.id}
                onSelect={(sessionId) => setActiveChatSession(chatPane.id, sessionId)}
                onDelete={(sessionId) => deleteChatSession(chatPane.id, sessionId)}
              />
            </Box>
          </>
        )}
      </Box>

      <ActiveToolsDialog
        tools={activeTools}
        open={activeToolsDialogOpen}
        onClose={() => setActiveToolsDialogOpen(false)}
      />
    </Box>
  );
};

export default ChatPanel;

