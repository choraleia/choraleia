import React, { useState, useEffect, useCallback } from "react";
import {
  Box,
  TextField,
  IconButton,
  Button,
  Typography,
  Chip,
  Tooltip,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  List,
  ListItem,
  ListItemButton,
  ListItemText,
  ListItemSecondaryAction,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import DeleteIcon from "@mui/icons-material/Delete";
import EditIcon from "@mui/icons-material/Edit";
import SearchIcon from "@mui/icons-material/Search";
import BoltIcon from "@mui/icons-material/Bolt";
import { sendToTerminal } from "./Terminal";
import {
  fetchQuickCommands,
  createQuickCommand,
  updateQuickCommand,
  deleteQuickCommand,
  reorderQuickCommands,
} from "../../api/quickcmd";

export interface QuickCommand {
  id: string;
  name: string;
  content: string;
  tags: string[];
  exec?: boolean; // default double-click executes
  updatedAt: number;
}

interface QuickCommandsPanelProps {
  activeTabKey: string;
}

const STORAGE_KEY = "quickCommands.v1";

function loadCommands(): QuickCommand[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (Array.isArray(arr)) return arr;
    return [];
  } catch {
    return [];
  }
}
function saveCommands(cmds: QuickCommand[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cmds));
  } catch {}
}

// simple variable substitution {{DATE}} {{TIME}}
function renderTemplate(text: string): string {
  const now = new Date();
  const ctx: Record<string, string> = {
    DATE: now.toISOString().slice(0, 10),
    TIME: now.toISOString().slice(11, 19),
  };
  return text.replace(/{{([A-Z_]+)}}/g, (_, k) => ctx[k] || `{{${k}}}`);
}

const QuickCommandsPanel: React.FC<QuickCommandsPanelProps> = ({
  activeTabKey,
}) => {
  // local state synchronized with backend
  const [commands, setCommands] = useState<QuickCommand[]>(() =>
    loadCommands(),
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>("");
  const [search, setSearch] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [editCmd, setEditCmd] = useState<QuickCommand | null>(null);
  const [formName, setFormName] = useState("");
  const [formContent, setFormContent] = useState("");
  const [formTags, setFormTags] = useState("");
  const [selectedIndex, setSelectedIndex] = useState<number>(-1);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null); // track current drag over target

  // initial backend load
  useEffect(() => {
    (async () => {
      setLoading(true);
      setError("");
      try {
        const list = await fetchQuickCommands();
        const mapped: QuickCommand[] = list.map((c) => ({
          id: c.id,
          name: c.name,
          content: c.content,
          tags: c.tags || [],
          updatedAt: Date.parse(c.updatedAt || new Date().toISOString()),
        }));
        setCommands(mapped);
        saveCommands(mapped);
      } catch (e: any) {
        setError(e.message || String(e));
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  useEffect(() => {
    saveCommands(commands);
  }, [commands]);

  const resetForm = () => {
    setFormName("");
    setFormContent("");
    setFormTags("");
    setEditCmd(null);
  };

  const openAdd = () => {
    resetForm();
    setAddOpen(true);
  };
  const openEdit = (cmd: QuickCommand) => {
    setEditCmd(cmd);
    setFormName(cmd.name);
    setFormContent(cmd.content);
    setFormTags(cmd.tags.join(","));
    setAddOpen(true);
  };

  const handleSave = async () => {
    if (!formName.trim() || !formContent.trim()) return;
    try {
      if (editCmd) {
        const updated = await updateQuickCommand(editCmd.id, {
          name: formName.trim(),
          content: formContent,
          tags: formTags
            .split(",")
            .map((t) => t.trim())
            .filter(Boolean),
        });
        setCommands((prev) =>
          prev.map((c) =>
            c.id === editCmd.id
              ? {
                  id: updated.id,
                  name: updated.name,
                  content: updated.content,
                  tags: updated.tags || [],
                  updatedAt: Date.parse(
                    updated.updatedAt || new Date().toISOString(),
                  ),
                }
              : c,
          ),
        );
      } else {
        const created = await createQuickCommand({
          name: formName.trim(),
          content: formContent,
          tags: formTags
            .split(",")
            .map((t) => t.trim())
            .filter(Boolean),
        });
        const cmd: QuickCommand = {
          id: created.id,
          name: created.name,
          content: created.content,
          tags: created.tags || [],
          updatedAt: Date.parse(created.updatedAt || new Date().toISOString()),
        };
        setCommands((prev) => [cmd, ...prev]);
      }
    } catch (e: any) {
      setError(e.message || String(e));
    }
    setAddOpen(false);
    resetForm();
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteQuickCommand(id);
      setCommands((prev) => prev.filter((c) => c.id !== id));
    } catch (e: any) {
      setError(e.message || String(e));
    }
  };

  const filtered = commands.filter((c) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      c.name.toLowerCase().includes(q) ||
      c.content.toLowerCase().includes(q) ||
      c.tags.some((t) => t.toLowerCase().includes(q))
    );
  });

  const insertCommand = useCallback(
    (cmd: QuickCommand, execute: boolean) => {
      if (!activeTabKey || activeTabKey === "welcome") return;
      const text = renderTemplate(cmd.content);
      sendToTerminal(activeTabKey, text, execute);
    },
    [activeTabKey],
  );

  // keyboard shortcuts: up/down select and Enter insert; Ctrl+Enter execute
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!document.body.contains(document.activeElement)) return;
      if (e.ctrlKey && e.key.toLowerCase() === "k") {
        // focus search
        if (searchInputRef.current) {
          searchInputRef.current.focus();
          e.preventDefault();
        }
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((prev) => {
          const len = filtered.length;
          if (len === 0) return -1;
          return prev < len - 1 ? prev + 1 : 0;
        });
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((prev) => {
          const len = filtered.length;
          if (len === 0) return -1;
          return prev > 0 ? prev - 1 : len - 1;
        });
      } else if (e.key === "Enter") {
        if (selectedIndex >= 0 && selectedIndex < filtered.length) {
          const cmd = filtered[selectedIndex];
          insertCommand(cmd, e.ctrlKey || e.metaKey || e.shiftKey); // execute when modifier key is pressed
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [filtered, selectedIndex, insertCommand]);

  // drag sort
  const onDragStartItem = (e: React.DragEvent, id: string) => {
    setDraggingId(id);
    setDragOverId(null);
    try {
      e.dataTransfer.setData("text/plain", id);
      e.dataTransfer.setData("application/x-quickcmd-id", id);
      e.dataTransfer.effectAllowed = "move";
    } catch {}
  };
  const onDragOverItem = (e: React.DragEvent, overId: string) => {
    e.preventDefault();
    if (draggingId && draggingId !== overId) {
      setDragOverId(overId);
      e.dataTransfer.dropEffect = "move";
    }
  };
  const onDragEndItem = () => {
    setDraggingId(null);
    setDragOverId(null);
  };
  const onDropItem = async (e: React.DragEvent, targetId: string) => {
    e.preventDefault();
    const dragId =
      draggingId ||
      e.dataTransfer.getData("application/x-quickcmd-id") ||
      e.dataTransfer.getData("text/plain");
    setDraggingId(null);
    setDragOverId(null);
    if (!dragId || dragId === targetId) return;
    setCommands((prev) => {
      const idxDrag = prev.findIndex((c) => c.id === dragId);
      const idxTarget = prev.findIndex((c) => c.id === targetId);
      if (idxDrag < 0 || idxTarget < 0) return prev;
      const newArr = [...prev];
      const [item] = newArr.splice(idxDrag, 1);
      newArr.splice(idxTarget, 0, item);
      reorderQuickCommands(newArr.map((c) => c.id)).catch((err) =>
        setError(err.message || String(err)),
      );
      return newArr;
    });
  };

  const searchInputRef = React.useRef<HTMLInputElement>(null);
  // removed debounce clickTimeoutRef
  // useEffect(() => () => { if (clickTimeoutRef.current) { clearTimeout(clickTimeoutRef.current); } }, []);

  // Auto focus search input when panel mounts
  useEffect(() => {
    if (searchInputRef.current) {
      searchInputRef.current.focus();
    }
  }, []);

  return (
    <Box display="flex" flexDirection="column" height="100%">
      <Box
        p={1}
        display="flex"
        gap={1}
        alignItems="center"
        borderBottom={(theme) => `1px solid ${theme.palette.divider}`}
      >
        <TextField
          inputRef={searchInputRef}
          size="small"
          placeholder="Search (Ctrl+K)"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          InputProps={{ startAdornment: <SearchIcon fontSize="small" /> }}
          sx={{ flex: 1 }}
        />
        <IconButton size="small" onClick={openAdd}>
          <AddIcon fontSize="small" />
        </IconButton>
      </Box>
      {loading && (
        <Box px={2} py={0.5} fontSize={12} color="text.secondary">
          Loading...
        </Box>
      )}
      {error && (
        <Box px={2} py={0.5} fontSize={12} color="error.main">
          {error}
        </Box>
      )}
      <Box flex={1} overflow="auto">
        {filtered.length === 0 && (
          <Box p={2} color="text.secondary" fontSize={13}>
            No matching commands
          </Box>
        )}
        <List dense>
          {filtered.map((cmd, i) => {
            const isDragging = draggingId === cmd.id;
            const isDragOver = dragOverId === cmd.id && draggingId !== cmd.id;
            return (
              <ListItem
                key={cmd.id}
                disablePadding
                onDragOver={(e) => onDragOverItem(e, cmd.id)}
                onDrop={(e) => onDropItem(e, cmd.id)}
              >
                <ListItemButton
                  draggable
                  onDragStart={(e) => onDragStartItem(e, cmd.id)}
                  onDragEnd={onDragEndItem}
                  selected={i === selectedIndex}
                  onClick={() => {
                    setSelectedIndex(i);
                    insertCommand(cmd, false); // insert text only
                  }}
                  onDoubleClick={() => {
                    setSelectedIndex(i);
                    insertCommand(cmd, true); // execute (re-sends command + newline)
                  }}
                  sx={{
                    opacity: isDragging ? 0.5 : 1,
                    border: isDragOver
                      ? "1px dashed rgba(0,0,0,0.3)"
                      : "1px solid transparent",
                    transition: "border-color 0.15s, opacity 0.15s",
                    cursor: "grab",
                    userSelect: "none",
                  }}
                >
                  <ListItemText
                    primary={
                      <Box display="flex" alignItems="center" gap={1}>
                        <Typography variant="body2" noWrap>
                          {cmd.name}
                        </Typography>
                        {cmd.tags.slice(0, 3).map((t) => (
                          <Chip size="small" key={t} label={t} />
                        ))}
                      </Box>
                    }
                    secondary={
                      <Typography
                        variant="caption"
                        component="div"
                        sx={{
                          whiteSpace: "nowrap",
                          textOverflow: "ellipsis",
                          overflow: "hidden",
                        }}
                      >
                        {cmd.content}
                      </Typography>
                    }
                  />
                  <ListItemSecondaryAction
                    sx={{
                      display: "flex",
                      flexDirection: "row",
                      alignItems: "center",
                      gap: 0.5,
                    }}
                  >
                    <Tooltip title="Insert">
                      <IconButton
                        edge="end"
                        size="small"
                        onClick={(e) => {
                          e.stopPropagation();
                          insertCommand(cmd, false);
                        }}
                      >
                        <BoltIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                    <Tooltip title="Insert & Run">
                      <IconButton
                        edge="end"
                        size="small"
                        onClick={(e) => {
                          e.stopPropagation();
                          insertCommand(cmd, true);
                        }}
                      >
                        <PlayArrowIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                    <Tooltip title="Edit">
                      <IconButton
                        edge="end"
                        size="small"
                        onClick={(e) => {
                          e.stopPropagation();
                          openEdit(cmd);
                        }}
                      >
                        <EditIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                    <Tooltip title="Delete">
                      <IconButton
                        edge="end"
                        size="small"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDelete(cmd.id);
                        }}
                      >
                        <DeleteIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  </ListItemSecondaryAction>
                </ListItemButton>
              </ListItem>
            );
          })}
        </List>
      </Box>

      {/* Add/Edit Dialog */}
      <Dialog
        open={addOpen}
        onClose={() => setAddOpen(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>{editCmd ? "Edit Command" : "New Command"}</DialogTitle>
        <DialogContent>
          <Box display="flex" flexDirection="column" gap={2} mt={1}>
            <TextField
              placeholder="Name"
              value={formName}
              onChange={(e) => setFormName(e.target.value)}
              fullWidth
              size="small"
            />
            <TextField
              placeholder="Content"
              value={formContent}
              onChange={(e) => setFormContent(e.target.value)}
              fullWidth
              size="small"
              multiline
              minRows={3}
            />
            <TextField
              placeholder="Tags (comma separated)"
              value={formTags}
              onChange={(e) => setFormTags(e.target.value)}
              fullWidth
              size="small"
            />
            <Typography variant="caption" color="text.secondary">
              Variables: {"{{DATE}}"} {"{{TIME}}"}; Double-click executes;
              Up/Down select; Enter insert; Ctrl/Shift+Enter execute; Drag to
              reorder.
            </Typography>
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setAddOpen(false)}>Cancel</Button>
          <Button
            variant="contained"
            onClick={handleSave}
            disabled={!formName.trim() || !formContent.trim()}
          >
            Save
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default QuickCommandsPanel;
