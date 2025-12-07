import React from "react";
import {
  Box,
  Button,
  Chip,
  Drawer,
  IconButton,
  List,
  ListItem,
  ListItemButton,
  ListItemText,
  Stack,
  TextField,
  Tooltip,
  Typography,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
} from "@mui/material";
import SendIcon from "@mui/icons-material/Send";
import SaveIcon from "@mui/icons-material/Save";
import DeleteIcon from "@mui/icons-material/Delete";
import CloseIcon from "@mui/icons-material/Close";
import DonutLargeIcon from "@mui/icons-material/DonutLarge";
import PlaylistAddCheckIcon from "@mui/icons-material/PlaylistAddCheck";
import { styled } from "@mui/material/styles";
import { useWorkspaces, EditorPane, ToolPane, ChatSession, ToolSession } from "../../state/workspaces";
import Editor from "@monaco-editor/react";
import { useMemo, useState } from "react";

const Textarea = styled("textarea")(({ theme }) => ({
  width: "100%",
  minHeight: 180,
  borderRadius: theme.shape.borderRadius,
  border: `1px solid ${theme.palette.divider}`,
  padding: theme.spacing(1.5),
  fontFamily: "JetBrains Mono, monospace",
  fontSize: 14,
  background: theme.palette.background.paper,
  color: theme.palette.text.primary,
  resize: "vertical",
}));

const ChatSessionList: React.FC<{
  sessions: ChatSession[];
  activeSessionId: string;
  onSelect: (sessionId: string) => void;
  onCreate: () => void;
  onDelete: (sessionId: string) => void;
}> = ({ sessions, activeSessionId, onSelect, onCreate, onDelete }) => (
  <Box width={320} display="flex" flexDirection="column" height="100%">
    <Stack direction="row" alignItems="center" justifyContent="space-between" px={2} py={1}>
      <Typography variant="subtitle1">Sessions</Typography>
      <Button size="small" onClick={onCreate}>
        New
      </Button>
    </Stack>
    <List dense sx={{ flex: 1, overflow: "auto", pt: 0 }}>
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
            <ListItemText primary={session.title} secondary={`Updated ${new Date(session.updatedAt).toLocaleTimeString()}`} />
          </ListItemButton>
        </ListItem>
      ))}
    </List>
  </Box>
);

interface ChatPaneViewProps {
  chatHistoryOpen?: boolean;
  onCloseChatHistory?: () => void;
}

const ActiveToolsDialog: React.FC<{ tools: ToolSession[]; open: boolean; onClose: () => void }> = ({ tools, open, onClose }) => (
  <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
    <DialogTitle>Active Tools</DialogTitle>
    <DialogContent dividers>
      {tools.length === 0 ? (
        <Typography variant="body2" color="text.secondary">
          No active tools in this session.
        </Typography>
      ) : (
        tools.map((tool) => (
          <Box key={tool.id} mb={1}>
            <Typography variant="body2" color="text.primary">
              {tool.label}
            </Typography>
            {tool.summary && (
              <Typography variant="caption" color="text.secondary">
                {tool.summary}
              </Typography>
            )}
          </Box>
        ))
      )}
    </DialogContent>
    <DialogActions>
      <Button onClick={onClose}>Close</Button>
    </DialogActions>
  </Dialog>
);

const ChatPaneView: React.FC<ChatPaneViewProps> = ({ chatHistoryOpen, onCloseChatHistory }) => {
  const {
    activeSpace,
    sendChatMessage,
    setActiveChatSession,
    createChatSession,
    deleteChatSession,
  } = useWorkspaces();
  const [activeToolsDialogOpen, setActiveToolsDialogOpen] = useState(false);
  const [draft, setDraft] = React.useState("");
  if (!activeSpace) return null;
  const pane = activeSpace.panes.find((p) => p.id === activeSpace.activePaneId);
  if (!pane || pane.kind !== "chat" || !pane.sessions?.length) return null;
  const activeSession =
    pane.sessions.find((s) => s.id === pane.activeSessionId) || pane.sessions[0];
  const activeTools = useMemo(() => activeSession?.activeTools ?? [], [activeSession]);
  const sessionIdToUse = activeSession.id;
  return (
    <Box display="flex" height="100%" position="relative">
      <Box display="flex" flexDirection="column" flex={1} px={3} py={2} gap={2}>
        <Stack direction={{ xs: "column", sm: "row" }} alignItems={{ xs: "flex-start", sm: "center" }} gap={1} flexWrap="wrap">
          <Typography variant="subtitle2" color="text.secondary">
            Chat inside {activeSpace.name} remembers context like files and terminals.
          </Typography>
          <Box flex={1} />
          {activeTools.length > 0 ? (
            <Button
              size="small"
              variant="outlined"
              startIcon={<PlaylistAddCheckIcon fontSize="small" />}
              onClick={() => setActiveToolsDialogOpen(true)}
            >
              Active tools ({activeTools.length})
            </Button>
          ) : (
            <Chip label="No active tools" size="small" variant="outlined" icon={<DonutLargeIcon fontSize="small" />} />
          )}
        </Stack>
        <Box flex={1} overflow="auto" display="flex" flexDirection="column" gap={1.5}>
          {activeSession?.messages.map((msg) => (
            <Stack key={msg.id} alignSelf={msg.role === "user" ? "flex-end" : "flex-start"}>
              <Chip
                label={msg.role === "user" ? "You" : "Omni Agent"}
                size="small"
                color={msg.role === "user" ? "default" : "primary"}
                sx={{ alignSelf: msg.role === "user" ? "flex-end" : "flex-start" }}
              />
              <Box
                mt={0.5}
                p={1.5}
                borderRadius={2}
                maxWidth={420}
                bgcolor={msg.role === "user" ? "background.paper" : "background.default"}
                border={(theme) => `1px solid ${theme.palette.divider}`}
              >
                <Typography variant="body2" whiteSpace="pre-wrap">
                  {msg.content}
                </Typography>
              </Box>
            </Stack>
          ))}
        </Box>
        <Stack direction="row" spacing={1} alignItems="center">
          <TextField
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Ask the AI to run commands, summarize files, or open tools."
            fullWidth
            multiline
            minRows={2}
          />
          <Button
            variant="contained"
            endIcon={<SendIcon />}
            onClick={() => {
              sendChatMessage(pane.id, draft);
              setDraft("");
            }}
            disabled={!draft.trim()}
          >
            Send
          </Button>
        </Stack>
      </Box>
      <Drawer
        anchor="right"
        open={!!chatHistoryOpen}
        onClose={onCloseChatHistory}
        ModalProps={{ keepMounted: true }}
      >
        <Box display="flex" justifyContent="flex-end" p={1}>
          <IconButton size="small" onClick={onCloseChatHistory}>
            <CloseIcon fontSize="small" />
          </IconButton>
        </Box>
        <ChatSessionList
          sessions={pane.sessions}
          activeSessionId={sessionIdToUse}
          onSelect={(sessionId) => setActiveChatSession(pane.id, sessionId)}
          onCreate={() => createChatSession(pane.id)}
          onDelete={(sessionId) => deleteChatSession(pane.id, sessionId)}
        />
      </Drawer>
      <ActiveToolsDialog tools={activeTools} open={activeToolsDialogOpen} onClose={() => setActiveToolsDialogOpen(false)} />
    </Box>
  );
};

const EditorPaneView: React.FC<{ pane: EditorPane }> = ({ pane }) => {
  const { updateEditorContent, saveEditorContent, closePane } = useWorkspaces();
  return (
    <Box flex={1} display="flex" flexDirection="column" px={3} py={2} gap={1.5}>
      <Stack direction="row" alignItems="center" gap={1}>
        <Typography variant="h6">{pane.title}</Typography>
        {pane.dirty && <Chip label="Unsaved" color="warning" size="small" />}
        <Box flex={1} />
        <Button
          variant="outlined"
          startIcon={<SaveIcon />}
          onClick={() => saveEditorContent(pane.id)}
          disabled={!pane.dirty}
        >
          Save
        </Button>
        <IconButton onClick={() => closePane(pane.id)}>
          <CloseIcon />
        </IconButton>
      </Stack>
      <Typography variant="caption" color="text.secondary">
        {pane.filePath}
      </Typography>
      <Box flex={1} minHeight={0} border={(theme) => `1px solid ${theme.palette.divider}`} borderRadius={1} overflow="hidden">
        <Editor
          height="100%"
          defaultLanguage={pane.filePath.endsWith(".md") ? "markdown" : undefined}
          value={pane.content}
          onChange={(value) => updateEditorContent(pane.id, value ?? "")}
          options={{ minimap: { enabled: false }, fontSize: 13, scrollBeyondLastLine: false }}
        />
      </Box>
    </Box>
  );
};

const ToolPaneView: React.FC<{ pane: ToolPane }> = ({ pane }) => (
  <Box flex={1} display="flex" flexDirection="column" px={3} py={2} gap={1.5}>
    <Typography variant="h6">{pane.title}</Typography>
    <Typography variant="body2" color="text.secondary">
      {pane.summary}
    </Typography>
    <Box flex={1} border={(theme) => `1px dashed ${theme.palette.divider}`} borderRadius={2}>
      <Typography p={2} color="text.secondary">
        Tool preview placeholder. Terminals, browsers, and job consoles render here without stealing chat space.
      </Typography>
    </Box>
  </Box>
);

const EmptyState: React.FC = () => (
  <Box flex={1} display="flex" alignItems="center" justifyContent="center">
    <Stack spacing={1} alignItems="center">
      <Typography variant="h6">No pane selected</Typography>
      <Typography variant="body2" color="text.secondary">
        Use the file tree or chat to open editors, tools, or AI conversations.
      </Typography>
    </Stack>
  </Box>
);

interface SpaceCanvasProps {
  chatHistoryOpen?: boolean;
  onCloseChatHistory?: () => void;
}

const SpaceCanvas: React.FC<SpaceCanvasProps> = ({ chatHistoryOpen, onCloseChatHistory }) => {
  const { activeSpace } = useWorkspaces();
  if (!activeSpace) return <EmptyState />;
  const pane = activeSpace.panes.find((p) => p.id === activeSpace.activePaneId);
  if (!pane) return <EmptyState />;
  if (pane.kind === "chat")
    return (
      <ChatPaneView
        chatHistoryOpen={chatHistoryOpen}
        onCloseChatHistory={onCloseChatHistory}
      />
    );
  if (pane.kind === "editor") return <EditorPaneView pane={pane} />;
  if (pane.kind === "tool") return <ToolPaneView pane={pane} />;
  return <EmptyState />;
};

export default SpaceCanvas;

