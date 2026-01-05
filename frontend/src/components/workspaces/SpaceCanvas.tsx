import React from "react";
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
  TextField,
  Tooltip,
  Typography,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Tabs,
  Tab,
  Divider,
  MenuItem, Select,
  TextareaAutosize,
} from "@mui/material";
import SendIcon from "@mui/icons-material/Send";
import SaveIcon from "@mui/icons-material/Save";
import DeleteIcon from "@mui/icons-material/Delete";
import CloseIcon from "@mui/icons-material/Close";
import DonutLargeIcon from "@mui/icons-material/DonutLarge";
import PlaylistAddCheckIcon from "@mui/icons-material/PlaylistAddCheck";
import { styled, alpha } from "@mui/material/styles";
import { useWorkspaces, EditorPane, ToolPane, ChatSession, ToolSession } from "../../state/workspaces";
import Editor from "@monaco-editor/react";
import { useMemo, useState } from "react";
import TerminalComponent from "../assets/Terminal";

const Textarea = styled(TextareaAutosize)(({ theme }) => ({
  width: "100%",
  border: "none",
  padding: theme.spacing(0.5, 0.25),
  fontFamily: "JetBrains Mono, monospace",
  fontSize: 14,
  lineHeight: 1.4,
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
  onToggleChatHistory?: () => void;
}

const ActiveToolsDialog: React.FC<{ tools: ToolSession[]; open: boolean; onClose: () => void }> = ({ tools, open, onClose }) => {
  const [selectedTab, setSelectedTab] = React.useState<string>(tools[0]?.id ?? "");
  React.useEffect(() => {
    if (!tools.length) {
      setSelectedTab("");
      return;
    }
    setSelectedTab((prev) => (tools.some((tool) => tool.id === prev) ? prev : tools[0].id));
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
      maxWidth={false}
      PaperProps={{
        sx: {
          width: "90vw",
          height: "90vh",
          maxWidth: "90vw",
          maxHeight: "90vh",
          display: "flex",
          flexDirection: "column",
        },
      }}
    >
      <DialogTitle>Active Tools</DialogTitle>
      <DialogContent
        dividers
        sx={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          p: tools.length ? 0 : 3,
        }}
      >
        {tools.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            No active tools in this session.
          </Typography>
        ) : (
          <>
            <Tabs
              value={selectedTab}
              onChange={(_event, value) => setSelectedTab(value)}
              variant="scrollable"
              scrollButtons="auto"
              allowScrollButtonsMobile
              sx={{ px: 3, pt: 1.5, borderBottom: (theme) => `1px solid ${theme.palette.divider}` }}
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
                  sx={{ alignItems: "flex-start" }}
                />
              ))}
            </Tabs>
            <Box flex={1} p={3} overflow="auto">
              {activeTool && (
                <Stack spacing={2} maxWidth={720}>
                  <Stack direction="row" spacing={2} alignItems="center">
                    <Typography variant="h6">{activeTool.label}</Typography>
                    <Chip
                      label={activeTool.status === "running" ? "Live" : activeTool.status}
                      color={statusColor[activeTool.status]}
                      size="small"
                    />
                  </Stack>
                  {activeTool.summary && (
                    <Typography variant="body1" color="text.secondary">
                      {activeTool.summary}
                    </Typography>
                  )}
                  <Stack spacing={1}>
                    <Typography variant="subtitle2" color="text.secondary">
                      Connection
                    </Typography>
                    {activeTool.endpoint ? (
                      <Typography variant="body2">
                        {activeTool.endpoint.host}:{activeTool.endpoint.port}
                      </Typography>
                    ) : (
                      <Typography variant="body2" color="text.secondary">
                        No network endpoint exposed.
                      </Typography>
                    )}
                  </Stack>
                  {activeTool.connectionTime && (
                    <Typography variant="caption" color="text.secondary">
                      Active since {new Date(activeTool.connectionTime).toLocaleString()}
                    </Typography>
                  )}
                </Stack>
              )}
            </Box>
          </>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
};

const ChatPaneView: React.FC<ChatPaneViewProps> = ({ chatHistoryOpen, onCloseChatHistory, onToggleChatHistory }) => {
  const {
    activeRoom,
    sendChatMessage,
    setActiveChatSession,
    createChatSession,
    deleteChatSession,
  } = useWorkspaces();
  const [activeToolsDialogOpen, setActiveToolsDialogOpen] = useState(false);
  const [draft, setDraft] = React.useState("");
  const [agentMode, setAgentMode] = useState("agents");
  const [modelChoice, setModelChoice] = useState("gpt-4o-mini");
  if (!activeRoom) return null;
  const pane = activeRoom.panes.find((p) => p.id === activeRoom.activePaneId);
  if (!pane || pane.kind !== "chat" || !pane.sessions?.length) return null;
  const activeSession =
    pane.sessions.find((s) => s.id === pane.activeSessionId) || pane.sessions[0];
  const activeTools = useMemo(() => activeSession?.activeTools ?? [], [activeSession]);
  const sessionIdToUse = activeSession.id;
  const historyWidth = 320;
  return (
    <Box display="flex" height="100%">
      <Box display="flex" flexDirection="column" flex={1} px={3} py={2} gap={2}>
        <Stack direction={{ xs: "column", sm: "row" }} alignItems={{ xs: "flex-start", sm: "center" }} gap={1} flexWrap="wrap">
          <Typography variant="subtitle2" color="text.secondary">
            Chat inside {activeRoom.name} remembers context like files and terminals.
          </Typography>
          <Box flex={1} />
          <Stack direction="row" spacing={1} alignItems="center">
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
            <Button size="small" variant="outlined" onClick={() => createChatSession(pane.id)}>
              New
            </Button>
            <Button size="small" variant={chatHistoryOpen ? "contained" : "outlined"} onClick={onToggleChatHistory}>
              {chatHistoryOpen ? "Hide history" : "Show history"}
            </Button>
          </Stack>
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
        <Box>
          <ComposerContainer>
            <Textarea
              sx={{ fontSize: 12 }}
              minRows={1}
              maxRows={5}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Ask the AI to run commands, summarize files, or open tools."
            />
            <Stack direction="row" alignItems="center" spacing={0.75}>
              <Select
                sx={{
                  boxShadow: "none",
                  ".MuiOutlinedInput-notchedOutline": { border: 0 },
                  "&.MuiOutlinedInput-root:hover .MuiOutlinedInput-notchedOutline":
                      {
                        border: 0,
                      },
                  "&.MuiOutlinedInput-root.Mui-focused .MuiOutlinedInput-notchedOutline":
                      {
                        border: 0,
                      },
                }}
                size="small"
                placeholder="Agent mode"
                value={agentMode}
                onChange={(event) => setAgentMode(event.target.value)}
                MenuProps={{
                  MenuListProps: { dense: true },
                  sx: {
                    "& .MuiMenuItem-root": {
                      minHeight: 16,
                    },
                  },
                }}
              >
                <MenuItem value="agents">Autonomous</MenuItem>
                <MenuItem value="assistant">Assistant</MenuItem>
              </Select>
              <Select
                sx={{
                  boxShadow: "none",
                  ".MuiOutlinedInput-notchedOutline": { border: 0 },
                  "&.MuiOutlinedInput-root:hover .MuiOutlinedInput-notchedOutline":
                      {
                        border: 0,
                      },
                  "&.MuiOutlinedInput-root.Mui-focused .MuiOutlinedInput-notchedOutline":
                      {
                        border: 0,
                      },
                }}
                size="small"
                placeholder="Model"
                value={modelChoice}
                onChange={(event) => setModelChoice(event.target.value)}
                MenuProps={{
                  MenuListProps: { dense: true },
                  sx: {
                    "& .MuiMenuItem-root": {
                      minHeight: 16,
                    },
                  },
                }}
              >
                <MenuItem value="gpt-4o-mini">GPT-4o mini</MenuItem>
                <MenuItem value="claude-3.5">Claude 3.5</MenuItem>
                <MenuItem value="local-mixtral">Local Mixtral</MenuItem>
              </Select>
              <Box flex={1} />
              <IconButton
                color="primary"
                onClick={() => {
                  sendChatMessage(pane.id, draft);
                  setDraft("");
                }}
                disabled={!draft.trim()}
              >
                <SendIcon fontSize="small" />
              </IconButton>
            </Stack>
          </ComposerContainer>
        </Box>
      </Box>
      {chatHistoryOpen && (
        <Divider orientation="vertical" flexItem sx={{ borderColor: (theme) => theme.palette.divider }} />
      )}
      <Box
        sx={{
          width: chatHistoryOpen ? historyWidth : 0,
          transition: "width 0.2s ease",
          overflow: "hidden",
          display: chatHistoryOpen ? "flex" : "none",
        }}
      >
        <ChatSessionList
          sessions={pane.sessions}
          activeSessionId={sessionIdToUse}
          onSelect={(sessionId) => setActiveChatSession(pane.id, sessionId)}
          onDelete={(sessionId) => deleteChatSession(pane.id, sessionId)}
        />
      </Box>
      <ActiveToolsDialog tools={activeTools} open={activeToolsDialogOpen} onClose={() => setActiveToolsDialogOpen(false)} />
    </Box>
  );
};

const EditorPaneView: React.FC<{ pane: EditorPane }> = ({ pane }) => {
  const { updateEditorContent } = useWorkspaces();
  return (
    <Box flex={1} display="flex" flexDirection="column" minHeight={0}>
      <Editor
        height="100%"
        defaultLanguage={pane.filePath.endsWith(".md") ? "markdown" : undefined}
        value={pane.content}
        onChange={(value) => updateEditorContent(pane.id, value ?? "")}
        options={{ minimap: { enabled: false }, fontSize: 13, scrollBeyondLastLine: false }}
      />
    </Box>
  );
};

const ToolPaneView: React.FC<{ pane: ToolPane; isActive?: boolean }> = ({ pane, isActive = true }) => {
  const { activeWorkspace } = useWorkspaces();

  // Check if this is a terminal pane by title (since toolSessions may not be persisted)
  const isTerminal = pane.title.startsWith("Terminal");

  // If this is a terminal tool, render the actual terminal
  // Use pane ID as terminal key to ensure each terminal has its own connection
  if (isTerminal && activeWorkspace) {
    const runtime = activeWorkspace.runtime;
    // Use pane ID to ensure each terminal pane has independent connection
    const terminalKey = `workspace-terminal-${activeWorkspace.id}-${pane.id}`;

    // Determine terminal configuration based on runtime type
    if (runtime.type === "local") {
      // Local terminal - use local asset
      return (
        <Box flex={1} display="flex" flexDirection="column" minHeight={0}>
          <TerminalComponent
            hostInfo={{ ip: "localhost", port: 0, name: "Local Terminal" }}
            tabKey={terminalKey}
            assetId="local"
            isActive={isActive}
          />
        </Box>
      );
    } else if ((runtime.type === "docker-local" || runtime.type === "docker-remote") && runtime.dockerAssetId) {
      // Docker terminal - use docker asset with container name/ID
      // Priority: containerName (actual running name) > containerId > generated default name
      const containerIdentifier = runtime.containerName || runtime.containerId ||
        (runtime.containerMode === "new" ? `choraleia-${activeWorkspace?.name}` : undefined);
      if (containerIdentifier) {
        return (
          <Box flex={1} display="flex" flexDirection="column" minHeight={0}>
            <TerminalComponent
              hostInfo={{ ip: "docker", port: 0, name: `Docker: ${containerIdentifier}` }}
              tabKey={terminalKey}
              assetId={runtime.dockerAssetId}
              containerId={containerIdentifier}
              isActive={isActive}
            />
          </Box>
        );
      } else {
        return (
          <Box flex={1} display="flex" flexDirection="column" px={3} py={2} gap={1.5}>
            <Typography variant="h6">{pane.title}</Typography>
            <Typography variant="body2" color="error">
              No container configured. Please configure a container in workspace settings.
            </Typography>
          </Box>
        );
      }
    }
  }

  // Fallback for non-terminal tools or unconfigured workspaces
  return (
    <Box flex={1} display="flex" flexDirection="column" px={3} py={2} gap={1.5}>
      <Typography variant="h6">{pane.title}</Typography>
      <Typography variant="body2" color="text.secondary">
        {pane.summary}
      </Typography>
      <Box flex={1} border={(theme) => `1px dashed ${theme.palette.divider}`} borderRadius={2}>
        <Typography p={2} color="text.secondary">
          Tool preview placeholder. Terminals, browsers, and job consoles render here.
        </Typography>
      </Box>
    </Box>
  );
};

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
  onToggleChatHistory?: () => void;
}

const SpaceCanvas: React.FC<SpaceCanvasProps> = ({ chatHistoryOpen, onCloseChatHistory, onToggleChatHistory }) => {
  const { activeRoom } = useWorkspaces();
  if (!activeRoom) return <EmptyState />;

  const activePane = activeRoom.panes.find((p) => p.id === activeRoom.activePaneId);

  // Get all terminal panes to keep them mounted
  const terminalPanes = activeRoom.panes.filter(
    (p): p is ToolPane => p.kind === "tool" && p.title.startsWith("Terminal")
  );

  return (
    <Box flex={1} display="flex" flexDirection="column" minHeight={0} position="relative">
      {/* Keep all terminal panes mounted but hidden when not active */}
      {terminalPanes.map((pane) => (
        <Box
          key={pane.id}
          flex={1}
          display={activePane?.id === pane.id ? "flex" : "none"}
          flexDirection="column"
          minHeight={0}
        >
          <ToolPaneView pane={pane} isActive={activePane?.id === pane.id} />
        </Box>
      ))}

      {/* Render active non-terminal panes */}
      {activePane && activePane.kind === "chat" && (
        <ChatPaneView
          chatHistoryOpen={chatHistoryOpen}
          onCloseChatHistory={onCloseChatHistory}
          onToggleChatHistory={onToggleChatHistory}
        />
      )}
      {activePane && activePane.kind === "editor" && <EditorPaneView pane={activePane} />}
      {activePane && activePane.kind === "tool" && !activePane.title.startsWith("Terminal") && (
        <ToolPaneView pane={activePane} isActive={true} />
      )}

      {/* Show empty state only when no active pane */}
      {!activePane && <EmptyState />}
    </Box>
  );
};

export default SpaceCanvas;

