// Add Memory Dialog - manually add memory to workspace
import React, { useState } from "react";
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  TextField,
  FormControl,
  Select,
  MenuItem,
  Typography,
  Box,
  Slider,
  Chip,
  Alert,
} from "@mui/material";
import PsychologyIcon from "@mui/icons-material/Psychology";

export interface CreateMemoryRequest {
  type: "fact" | "preference" | "instruction" | "learned";
  key: string;
  content: string;
  category?: string;
  tags?: string[];
  importance?: number;
}

export interface AddMemoryDialogProps {
  open: boolean;
  workspaceId: string;
  onClose: () => void;
  onSuccess?: (memory: any) => void;
  initialData?: Partial<CreateMemoryRequest>;
}

const MEMORY_TYPES = [
  { value: "fact", label: "Fact", desc: "Factual information" },
  { value: "preference", label: "Preference", desc: "User preferences" },
  { value: "instruction", label: "Instruction", desc: "Rules or instructions" },
  { value: "learned", label: "Learned", desc: "AI-learned patterns" },
];

export default function AddMemoryDialog({
  open,
  workspaceId,
  onClose,
  onSuccess,
  initialData,
}: AddMemoryDialogProps) {
  const [type, setType] = useState<CreateMemoryRequest["type"]>(initialData?.type || "fact");
  const [key, setKey] = useState(initialData?.key || "");
  const [content, setContent] = useState(initialData?.content || "");
  const [category, setCategory] = useState(initialData?.category || "");
  const [tagsInput, setTagsInput] = useState(initialData?.tags?.join(", ") || "");
  const [importance, setImportance] = useState(initialData?.importance || 50);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSave = async () => {
    if (!key.trim() || !content.trim()) {
      setError("Key and Content are required");
      return;
    }

    setSaving(true);
    setError(null);

    const tags = tagsInput
      .split(",")
      .map((t) => t.trim())
      .filter((t) => t.length > 0);

    const payload: CreateMemoryRequest = {
      type,
      key: key.trim(),
      content: content.trim(),
      category: category.trim() || undefined,
      tags: tags.length > 0 ? tags : undefined,
      importance,
    };

    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/memories`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to create memory");
      }

      const memory = await res.json();
      onSuccess?.(memory);
      handleClose();
    } catch (err: any) {
      setError(err.message || "Failed to create memory");
    } finally {
      setSaving(false);
    }
  };

  const handleClose = () => {
    setType("fact");
    setKey("");
    setContent("");
    setCategory("");
    setTagsInput("");
    setImportance(50);
    setError(null);
    onClose();
  };

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="sm" fullWidth>
      <DialogTitle>
        <Box display="flex" alignItems="center" gap={1}>
          <PsychologyIcon color="primary" />
          <Typography variant="h6">Add Memory</Typography>
        </Box>
      </DialogTitle>
      <DialogContent>
        <Box display="flex" flexDirection="column" gap={2} sx={{ mt: 1 }}>
          {error && (
            <Alert severity="error" onClose={() => setError(null)}>
              {error}
            </Alert>
          )}

          {/* Type */}
          <FormControl fullWidth size="small">
            <Typography variant="caption" color="text.secondary" mb={0.5}>
              Type *
            </Typography>
            <Select value={type} onChange={(e) => setType(e.target.value as any)}>
              {MEMORY_TYPES.map((t) => (
                <MenuItem key={t.value} value={t.value}>
                  <Box>
                    <Typography variant="body2">{t.label}</Typography>
                    <Typography variant="caption" color="text.secondary">
                      {t.desc}
                    </Typography>
                  </Box>
                </MenuItem>
              ))}
            </Select>
          </FormControl>

          {/* Key */}
          <Box>
            <Typography variant="caption" color="text.secondary" mb={0.5}>
              Key * <Typography component="span" variant="caption" color="text.disabled">(unique identifier)</Typography>
            </Typography>
            <TextField
              size="small"
              fullWidth
              placeholder="e.g., user_preference_theme"
              value={key}
              onChange={(e) => setKey(e.target.value.replace(/\s+/g, "_"))}
            />
          </Box>

          {/* Content */}
          <Box>
            <Typography variant="caption" color="text.secondary" mb={0.5}>
              Content *
            </Typography>
            <TextField
              size="small"
              fullWidth
              multiline
              rows={4}
              placeholder="The information to remember..."
              value={content}
              onChange={(e) => setContent(e.target.value)}
            />
          </Box>

          {/* Category */}
          <Box>
            <Typography variant="caption" color="text.secondary" mb={0.5}>
              Category
            </Typography>
            <TextField
              size="small"
              fullWidth
              placeholder="e.g., settings, coding, project"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
            />
          </Box>

          {/* Tags */}
          <Box>
            <Typography variant="caption" color="text.secondary" mb={0.5}>
              Tags <Typography component="span" variant="caption" color="text.disabled">(comma separated)</Typography>
            </Typography>
            <TextField
              size="small"
              fullWidth
              placeholder="e.g., ui, preferences, theme"
              value={tagsInput}
              onChange={(e) => setTagsInput(e.target.value)}
            />
            {tagsInput && (
              <Box display="flex" gap={0.5} flexWrap="wrap" mt={1}>
                {tagsInput.split(",").map((tag, idx) => {
                  const t = tag.trim();
                  return t ? (
                    <Chip key={idx} label={t} size="small" sx={{ height: 20, fontSize: 11 }} />
                  ) : null;
                })}
              </Box>
            )}
          </Box>

          {/* Importance */}
          <Box>
            <Typography variant="caption" color="text.secondary" mb={0.5}>
              Importance: {importance}
            </Typography>
            <Slider
              value={importance}
              onChange={(_, v) => setImportance(v as number)}
              min={1}
              max={100}
              valueLabelDisplay="auto"
              size="small"
            />
          </Box>
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={handleClose} disabled={saving}>
          Cancel
        </Button>
        <Button variant="contained" onClick={handleSave} disabled={saving || !key || !content}>
          {saving ? "Saving..." : "Save Memory"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

