// Memory Detail Panel - view and edit a single memory
import React, { useState, useEffect } from "react";
import {
  Box,
  Typography,
  Paper,
  Chip,
  IconButton,
  Button,
  TextField,
  Slider,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  CircularProgress,
  Divider,
  Tooltip,
} from "@mui/material";
import EditIcon from "@mui/icons-material/Edit";
import DeleteIcon from "@mui/icons-material/Delete";
import CloseIcon from "@mui/icons-material/Close";
import LinkIcon from "@mui/icons-material/Link";
import AccessTimeIcon from "@mui/icons-material/AccessTime";
import VisibilityIcon from "@mui/icons-material/Visibility";
import StarIcon from "@mui/icons-material/Star";
import LocalOfferIcon from "@mui/icons-material/LocalOffer";

interface Memory {
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
  expires_at?: string;
  source_type?: string;
  source_id?: string;
  created_at: string;
  updated_at: string;
}

interface MemorySourceInfo {
  source_type: string;
  source_id?: string;
  conversation_id?: string;
  conversation_name?: string;
  snapshot_id?: string;
  created_at?: string;
}

interface MemoryDetailPanelProps {
  workspaceId: string;
  memoryId: string;
  open: boolean;
  onClose: () => void;
  onDelete?: () => void;
  onUpdate?: (memory: Memory) => void;
  onViewSource?: (sourceId: string, sourceType: string) => void;
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

export default function MemoryDetailPanel({
  workspaceId,
  memoryId,
  open,
  onClose,
  onDelete,
  onUpdate,
  onViewSource,
}: MemoryDetailPanelProps) {
  const [memory, setMemory] = useState<Memory | null>(null);
  const [sourceInfo, setSourceInfo] = useState<MemorySourceInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editContent, setEditContent] = useState("");
  const [editTags, setEditTags] = useState("");
  const [editImportance, setEditImportance] = useState(50);
  const [saving, setSaving] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);

  // Fetch memory
  useEffect(() => {
    const fetchMemory = async () => {
      if (!memoryId || !open) return;

      setLoading(true);
      try {
        const res = await fetch(`/api/workspaces/${workspaceId}/memories/${memoryId}`);
        if (res.ok) {
          const data = await res.json();
          setMemory(data);
          setEditContent(data.content);
          setEditTags(data.tags?.join(", ") || "");
          setEditImportance(data.importance);
        }

        // Fetch source info
        const sourceRes = await fetch(`/api/workspaces/${workspaceId}/memories/${memoryId}/source`);
        if (sourceRes.ok) {
          const sourceData = await sourceRes.json();
          setSourceInfo(sourceData);
        }
      } catch (err) {
        console.error("Failed to fetch memory:", err);
      } finally {
        setLoading(false);
      }
    };

    fetchMemory();
  }, [workspaceId, memoryId, open]);

  // Save edits
  const handleSave = async () => {
    if (!memory) return;

    setSaving(true);
    try {
      const tags = editTags
        .split(",")
        .map((t) => t.trim())
        .filter((t) => t.length > 0);

      const res = await fetch(`/api/workspaces/${workspaceId}/memories/${memoryId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content: editContent,
          tags: tags.length > 0 ? tags : undefined,
          importance: editImportance,
        }),
      });

      if (res.ok) {
        const updated = await res.json();
        setMemory(updated);
        setEditing(false);
        onUpdate?.(updated);
      }
    } catch (err) {
      console.error("Failed to update memory:", err);
    } finally {
      setSaving(false);
    }
  };

  // Delete memory
  const handleDelete = async () => {
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/memories/${memoryId}`, {
        method: "DELETE",
      });
      if (res.ok) {
        onDelete?.();
        onClose();
      }
    } catch (err) {
      console.error("Failed to delete memory:", err);
    }
  };

  // Format date
  const formatDate = (dateStr?: string) => {
    if (!dateStr) return "-";
    return new Date(dateStr).toLocaleString();
  };

  // Format time ago
  const formatTimeAgo = (dateStr?: string) => {
    if (!dateStr) return "Never";
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);

    if (diffMins < 1) return "Just now";
    if (diffMins < 60) return `${diffMins} min ago`;
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours} hours ago`;
    return `${Math.floor(diffHours / 24)} days ago`;
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>
        <Box display="flex" alignItems="center" justifyContent="space-between">
          <Box display="flex" alignItems="center" gap={1}>
            {memory && (
              <>
                <Typography fontSize={20}>{TYPE_ICONS[memory.type] || "📄"}</Typography>
                <Typography variant="h6">Memory Detail</Typography>
              </>
            )}
          </Box>
          <Box display="flex" gap={0.5}>
            {!editing && memory && (
              <Tooltip title="Edit">
                <IconButton size="small" onClick={() => setEditing(true)}>
                  <EditIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            )}
            <IconButton size="small" onClick={onClose}>
              <CloseIcon fontSize="small" />
            </IconButton>
          </Box>
        </Box>
      </DialogTitle>

      <DialogContent dividers>
        {loading ? (
          <Box display="flex" justifyContent="center" py={4}>
            <CircularProgress />
          </Box>
        ) : !memory ? (
          <Typography color="text.secondary" textAlign="center" py={4}>
            Memory not found
          </Typography>
        ) : (
          <Box>
            {/* Type & Key */}
            <Box mb={2}>
              <Chip
                label={memory.type}
                size="small"
                sx={{
                  bgcolor: `${TYPE_COLORS[memory.type]}22`,
                  color: TYPE_COLORS[memory.type],
                  fontWeight: 500,
                  mb: 1,
                }}
              />
              <Typography variant="body1" fontWeight={600}>
                {memory.key}
              </Typography>
            </Box>

            <Divider sx={{ my: 2 }} />

            {/* Content */}
            <Box mb={2}>
              <Typography variant="caption" fontWeight={500} color="text.secondary" mb={0.5} display="block">
                Content
              </Typography>
              {editing ? (
                <TextField
                  fullWidth
                  multiline
                  rows={4}
                  value={editContent}
                  onChange={(e) => setEditContent(e.target.value)}
                  size="small"
                />
              ) : (
                <Paper variant="outlined" sx={{ p: 1.5, bgcolor: "action.hover" }}>
                  <Typography variant="body2" sx={{ whiteSpace: "pre-wrap" }}>
                    {memory.content}
                  </Typography>
                </Paper>
              )}
            </Box>

            {/* Tags */}
            <Box mb={2}>
              <Typography variant="caption" fontWeight={500} color="text.secondary" mb={0.5} display="flex" alignItems="center" gap={0.5}>
                <LocalOfferIcon sx={{ fontSize: 14 }} /> Tags
              </Typography>
              {editing ? (
                <TextField
                  fullWidth
                  size="small"
                  placeholder="tag1, tag2, tag3"
                  value={editTags}
                  onChange={(e) => setEditTags(e.target.value)}
                />
              ) : (
                <Box display="flex" gap={0.5} flexWrap="wrap">
                  {memory.tags?.length ? (
                    memory.tags.map((tag, idx) => (
                      <Chip key={idx} label={tag} size="small" sx={{ height: 22 }} />
                    ))
                  ) : (
                    <Typography variant="caption" color="text.disabled">No tags</Typography>
                  )}
                </Box>
              )}
            </Box>

            {/* Importance */}
            <Box mb={2}>
              <Typography variant="caption" fontWeight={500} color="text.secondary" mb={0.5} display="flex" alignItems="center" gap={0.5}>
                <StarIcon sx={{ fontSize: 14 }} /> Importance: {editing ? editImportance : memory.importance}
              </Typography>
              {editing ? (
                <Slider
                  value={editImportance}
                  onChange={(_, v) => setEditImportance(v as number)}
                  min={1}
                  max={100}
                  size="small"
                />
              ) : (
                <Box sx={{ height: 4, bgcolor: "action.hover", borderRadius: 1, overflow: "hidden" }}>
                  <Box
                    sx={{
                      height: "100%",
                      width: `${memory.importance}%`,
                      bgcolor: "primary.main",
                      borderRadius: 1,
                    }}
                  />
                </Box>
              )}
            </Box>

            <Divider sx={{ my: 2 }} />

            {/* Metadata */}
            <Box display="grid" gridTemplateColumns="1fr 1fr" gap={1.5} mb={2}>
              <Box>
                <Typography variant="caption" color="text.disabled">Category</Typography>
                <Typography variant="body2">{memory.category || "-"}</Typography>
              </Box>
              <Box>
                <Typography variant="caption" color="text.disabled">Scope</Typography>
                <Typography variant="body2">{memory.scope}</Typography>
              </Box>
              <Box>
                <Typography variant="caption" color="text.disabled">Visibility</Typography>
                <Typography variant="body2">{memory.visibility}</Typography>
              </Box>
              <Box>
                <Typography variant="caption" color="text.disabled" display="flex" alignItems="center" gap={0.5}>
                  <VisibilityIcon sx={{ fontSize: 12 }} /> Access Count
                </Typography>
                <Typography variant="body2">{memory.access_count}</Typography>
              </Box>
              <Box>
                <Typography variant="caption" color="text.disabled" display="flex" alignItems="center" gap={0.5}>
                  <AccessTimeIcon sx={{ fontSize: 12 }} /> Last Access
                </Typography>
                <Typography variant="body2">{formatTimeAgo(memory.last_access)}</Typography>
              </Box>
              <Box>
                <Typography variant="caption" color="text.disabled">Created</Typography>
                <Typography variant="body2">{formatDate(memory.created_at)}</Typography>
              </Box>
            </Box>

            {/* Source Info */}
            {sourceInfo && sourceInfo.source_type && (
              <>
                <Divider sx={{ my: 2 }} />
                <Box>
                  <Typography variant="caption" fontWeight={500} color="text.secondary" mb={1} display="flex" alignItems="center" gap={0.5}>
                    <LinkIcon sx={{ fontSize: 14 }} /> Source
                  </Typography>
                  <Paper variant="outlined" sx={{ p: 1.5 }}>
                    <Typography variant="body2" gutterBottom>
                      <strong>Type:</strong> {sourceInfo.source_type.replace(/_/g, " ")}
                    </Typography>
                    {sourceInfo.conversation_name && (
                      <Typography variant="body2" gutterBottom>
                        <strong>Conversation:</strong> {sourceInfo.conversation_name}
                      </Typography>
                    )}
                    {sourceInfo.source_id && onViewSource && (
                      <Button
                        size="small"
                        variant="outlined"
                        startIcon={<LinkIcon fontSize="small" />}
                        onClick={() => onViewSource(sourceInfo.source_id!, sourceInfo.source_type)}
                        sx={{ mt: 1 }}
                      >
                        View Source
                      </Button>
                    )}
                  </Paper>
                </Box>
              </>
            )}
          </Box>
        )}
      </DialogContent>

      <DialogActions>
        {editing ? (
          <>
            <Button onClick={() => setEditing(false)} disabled={saving}>
              Cancel
            </Button>
            <Button variant="contained" onClick={handleSave} disabled={saving}>
              {saving ? "Saving..." : "Save Changes"}
            </Button>
          </>
        ) : (
          <>
            <Button
              color="error"
              startIcon={<DeleteIcon />}
              onClick={() => setDeleteConfirm(true)}
            >
              Delete
            </Button>
            <Box flex={1} />
            <Button onClick={onClose}>Close</Button>
          </>
        )}
      </DialogActions>

      {/* Delete Confirmation */}
      <Dialog open={deleteConfirm} onClose={() => setDeleteConfirm(false)}>
        <DialogTitle>Delete Memory?</DialogTitle>
        <DialogContent>
          <Typography>
            Are you sure you want to delete this memory? This action cannot be undone.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteConfirm(false)}>Cancel</Button>
          <Button color="error" variant="contained" onClick={handleDelete}>
            Delete
          </Button>
        </DialogActions>
      </Dialog>
    </Dialog>
  );
}

