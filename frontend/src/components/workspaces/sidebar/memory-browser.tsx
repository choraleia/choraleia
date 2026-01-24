// Memory Browser - view and manage workspace memories
import React, { useState, useEffect, useCallback } from "react";
import {
  Box,
  Typography,
  TextField,
  FormControl,
  Select,
  MenuItem,
  IconButton,
  Paper,
  Chip,
  Tooltip,
  CircularProgress,
  InputAdornment,
  Collapse,
  Button,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
} from "@mui/material";
import SearchIcon from "@mui/icons-material/Search";
import DeleteIcon from "@mui/icons-material/Delete";
import EditIcon from "@mui/icons-material/Edit";
import AddIcon from "@mui/icons-material/Add";
import RefreshIcon from "@mui/icons-material/Refresh";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import ExpandLessIcon from "@mui/icons-material/ExpandLess";
import PsychologyIcon from "@mui/icons-material/Psychology";
import SettingsIcon from "@mui/icons-material/Settings";
import AddMemoryDialog from "./add-memory-dialog";

// Memory types
export interface Memory {
  id: string;
  workspace_id: string;
  scope: "workspace" | "agent";
  agent_id?: string;
  visibility: "public" | "private" | "inherit";
  type: "fact" | "preference" | "instruction" | "learned" | "summary" | "detail";
  category?: string;
  key: string;
  content: string;
  tags?: string[];
  importance: number;
  access_count: number;
  last_access?: string;
  created_at: string;
  updated_at: string;
}

interface MemoryBrowserProps {
  workspaceId: string;
  onMemorySelect?: (memory: Memory) => void;
  onSettingsClick?: () => void;
}

const TYPE_ICONS: Record<string, string> = {
  fact: "📌",
  preference: "❤️",
  instruction: "📋",
  learned: "💡",
  summary: "📝",
  detail: "🔍",
};

const TYPE_COLORS: Record<string, string> = {
  fact: "#2196f3",
  preference: "#e91e63",
  instruction: "#ff9800",
  learned: "#4caf50",
  summary: "#9c27b0",
  detail: "#607d8b",
};

export default function MemoryBrowser({
  workspaceId,
  onMemorySelect,
  onSettingsClick,
}: MemoryBrowserProps) {
  const [memories, setMemories] = useState<Memory[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [scopeFilter, setScopeFilter] = useState<string>("all");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  // Fetch memories
  const fetchMemories = useCallback(async () => {
    if (!workspaceId) return;

    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (typeFilter !== "all") params.set("type", typeFilter);
      if (scopeFilter !== "all") params.set("scope", scopeFilter);
      if (searchQuery) params.set("keyword", searchQuery);

      const res = await fetch(
        `/api/workspaces/${workspaceId}/memories?${params.toString()}`
      );
      if (res.ok) {
        const data = await res.json();
        setMemories(data.memories || []);
      }
    } catch (err) {
      console.error("Failed to fetch memories:", err);
    } finally {
      setLoading(false);
    }
  }, [workspaceId, typeFilter, scopeFilter, searchQuery]);

  useEffect(() => {
    fetchMemories();
  }, [fetchMemories]);

  // Search with debounce
  const [debouncedSearch, setDebouncedSearch] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchQuery);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  useEffect(() => {
    if (debouncedSearch !== undefined) {
      fetchMemories();
    }
  }, [debouncedSearch]);

  // Delete memory
  const handleDelete = async (memoryId: string) => {
    try {
      const res = await fetch(
        `/api/workspaces/${workspaceId}/memories/${memoryId}`,
        { method: "DELETE" }
      );
      if (res.ok) {
        setMemories((prev) => prev.filter((m) => m.id !== memoryId));
        setDeleteConfirm(null);
      }
    } catch (err) {
      console.error("Failed to delete memory:", err);
    }
  };

  // Format date
  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays === 0) return "Today";
    if (diffDays === 1) return "Yesterday";
    if (diffDays < 7) return `${diffDays} days ago`;
    if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`;
    return date.toLocaleDateString();
  };

  return (
    <Box sx={{ height: "100%", display: "flex", flexDirection: "column" }}>
      {/* Header */}
      <Box display="flex" alignItems="center" justifyContent="space-between" px={1.5} py={1}>
        <Box display="flex" alignItems="center" gap={1}>
          <PsychologyIcon fontSize="small" color="primary" />
          <Typography variant="subtitle2" fontWeight={600}>
            Workspace Memory
          </Typography>
        </Box>
        <Box display="flex" gap={0.5}>
          <Tooltip title="Refresh">
            <IconButton size="small" onClick={fetchMemories} disabled={loading}>
              <RefreshIcon fontSize="small" />
            </IconButton>
          </Tooltip>
          {onSettingsClick && (
            <Tooltip title="Memory Settings">
              <IconButton size="small" onClick={onSettingsClick}>
                <SettingsIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          )}
        </Box>
      </Box>

      {/* Search & Filters */}
      <Box px={1.5} pb={1}>
        <TextField
          size="small"
          fullWidth
          placeholder="Search memories..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <SearchIcon fontSize="small" sx={{ color: "text.disabled" }} />
              </InputAdornment>
            ),
          }}
          sx={{ mb: 1 }}
        />
        <Box display="flex" gap={1}>
          <FormControl size="small" sx={{ flex: 1 }}>
            <Select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              displayEmpty
              sx={{ fontSize: 12 }}
            >
              <MenuItem value="all">All Types</MenuItem>
              <MenuItem value="fact">Fact</MenuItem>
              <MenuItem value="preference">Preference</MenuItem>
              <MenuItem value="instruction">Instruction</MenuItem>
              <MenuItem value="learned">Learned</MenuItem>
              <MenuItem value="summary">Summary</MenuItem>
              <MenuItem value="detail">Detail</MenuItem>
            </Select>
          </FormControl>
          <FormControl size="small" sx={{ flex: 1 }}>
            <Select
              value={scopeFilter}
              onChange={(e) => setScopeFilter(e.target.value)}
              displayEmpty
              sx={{ fontSize: 12 }}
            >
              <MenuItem value="all">All Scopes</MenuItem>
              <MenuItem value="workspace">Workspace</MenuItem>
              <MenuItem value="agent">Agent</MenuItem>
            </Select>
          </FormControl>
        </Box>
      </Box>

      {/* Memory List */}
      <Box flex={1} overflow="auto" px={1.5}>
        {loading ? (
          <Box display="flex" justifyContent="center" py={4}>
            <CircularProgress size={24} />
          </Box>
        ) : memories.length === 0 ? (
          <Box textAlign="center" py={4} color="text.secondary">
            <PsychologyIcon sx={{ fontSize: 40, opacity: 0.3, mb: 1 }} />
            <Typography variant="body2">No memories found</Typography>
            <Typography variant="caption">
              Memories will appear here as the AI learns
            </Typography>
          </Box>
        ) : (
          <Box display="flex" flexDirection="column" gap={1} pb={1}>
            {memories.map((memory) => {
              const isExpanded = expandedId === memory.id;
              return (
                <Paper
                  key={memory.id}
                  variant="outlined"
                  sx={{
                    p: 1,
                    cursor: "pointer",
                    "&:hover": { bgcolor: "action.hover" },
                    borderLeft: `3px solid ${TYPE_COLORS[memory.type] || "#ccc"}`,
                  }}
                  onClick={() => {
                    setExpandedId(isExpanded ? null : memory.id);
                    onMemorySelect?.(memory);
                  }}
                >
                  {/* Header */}
                  <Box display="flex" alignItems="flex-start" gap={1}>
                    <Typography fontSize={14}>{TYPE_ICONS[memory.type] || "📄"}</Typography>
                    <Box flex={1} minWidth={0}>
                      <Box display="flex" alignItems="center" gap={0.5}>
                        <Typography
                          variant="caption"
                          sx={{
                            px: 0.5,
                            borderRadius: 0.5,
                            bgcolor: `${TYPE_COLORS[memory.type]}22`,
                            color: TYPE_COLORS[memory.type],
                            fontWeight: 500,
                          }}
                        >
                          {memory.type}
                        </Typography>
                        <Typography
                          variant="body2"
                          fontWeight={500}
                          noWrap
                          sx={{ flex: 1 }}
                        >
                          {memory.key}
                        </Typography>
                      </Box>
                      <Typography
                        variant="caption"
                        color="text.secondary"
                        sx={{
                          display: "-webkit-box",
                          WebkitLineClamp: isExpanded ? "none" : 2,
                          WebkitBoxOrient: "vertical",
                          overflow: "hidden",
                          mt: 0.5,
                        }}
                      >
                        {memory.content}
                      </Typography>
                    </Box>
                    <IconButton
                      size="small"
                      onClick={(e) => {
                        e.stopPropagation();
                        setExpandedId(isExpanded ? null : memory.id);
                      }}
                    >
                      {isExpanded ? (
                        <ExpandLessIcon fontSize="small" />
                      ) : (
                        <ExpandMoreIcon fontSize="small" />
                      )}
                    </IconButton>
                  </Box>

                  {/* Tags & Meta */}
                  <Box display="flex" alignItems="center" gap={1} mt={0.5} flexWrap="wrap">
                    {memory.tags?.slice(0, 3).map((tag, idx) => (
                      <Chip
                        key={idx}
                        label={tag}
                        size="small"
                        sx={{ height: 18, fontSize: 10 }}
                      />
                    ))}
                    <Typography variant="caption" color="text.disabled" sx={{ ml: "auto" }}>
                      ⭐{memory.importance} · {formatDate(memory.created_at)}
                    </Typography>
                  </Box>

                  {/* Expanded Details */}
                  <Collapse in={isExpanded}>
                    <Box mt={1} pt={1} borderTop="1px solid" borderColor="divider">
                      <Typography variant="caption" color="text.secondary" component="div">
                        <strong>Category:</strong> {memory.category || "-"}
                      </Typography>
                      <Typography variant="caption" color="text.secondary" component="div">
                        <strong>Scope:</strong> {memory.scope}
                        {memory.agent_id && ` (Agent: ${memory.agent_id.slice(0, 8)}...)`}
                      </Typography>
                      <Typography variant="caption" color="text.secondary" component="div">
                        <strong>Access Count:</strong> {memory.access_count}
                      </Typography>
                      <Box display="flex" gap={1} mt={1}>
                        <Button
                          size="small"
                          startIcon={<DeleteIcon fontSize="small" />}
                          color="error"
                          onClick={(e) => {
                            e.stopPropagation();
                            setDeleteConfirm(memory.id);
                          }}
                        >
                          Delete
                        </Button>
                      </Box>
                    </Box>
                  </Collapse>
                </Paper>
              );
            })}
          </Box>
        )}
      </Box>

      {/* Add Button */}
      <Box px={1.5} py={1} borderTop="1px solid" borderColor="divider">
        <Button
          fullWidth
          variant="outlined"
          startIcon={<AddIcon />}
          onClick={() => setShowAddDialog(true)}
          size="small"
        >
          Add Memory
        </Button>
      </Box>

      {/* Add Memory Dialog */}
      <AddMemoryDialog
        open={showAddDialog}
        workspaceId={workspaceId}
        onClose={() => setShowAddDialog(false)}
        onSuccess={() => {
          setShowAddDialog(false);
          fetchMemories();
        }}
      />

      {/* Delete Confirmation Dialog */}
      <Dialog open={!!deleteConfirm} onClose={() => setDeleteConfirm(null)}>
        <DialogTitle>Delete Memory?</DialogTitle>
        <DialogContent>
          <Typography>
            Are you sure you want to delete this memory? This action cannot be undone.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteConfirm(null)}>Cancel</Button>
          <Button
            color="error"
            variant="contained"
            onClick={() => deleteConfirm && handleDelete(deleteConfirm)}
          >
            Delete
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

