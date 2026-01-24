// Compression History - view conversation compression snapshots
import React, { useState, useEffect } from "react";
import {
  Box,
  Typography,
  Paper,
  Chip,
  IconButton,
  Collapse,
  CircularProgress,
  Button,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Tooltip,
} from "@mui/material";
import CompressIcon from "@mui/icons-material/Compress";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import ExpandLessIcon from "@mui/icons-material/ExpandLess";
import HistoryIcon from "@mui/icons-material/History";
import MessageIcon from "@mui/icons-material/Message";
import RefreshIcon from "@mui/icons-material/Refresh";

export interface CompressionSnapshot {
  id: string;
  conversation_id: string;
  summary: string;
  key_topics?: string[];
  key_decisions?: string[];
  message_count: number;
  start_message_id?: string;
  end_message_id?: string;
  token_count?: number;
  created_at: string;
}

export interface OriginalMessage {
  id: string;
  role: string;
  content: string;
  created_at: string;
}

export interface CompressionHistoryProps {
  conversationId: string;
  onViewMessages?: (snapshotId: string) => void;
}

export default function CompressionHistory({
  conversationId,
  onViewMessages,
}: CompressionHistoryProps) {
  const [snapshots, setSnapshots] = useState<CompressionSnapshot[]>([]);
  const [loading, setLoading] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [viewingMessages, setViewingMessages] = useState<string | null>(null);
  const [originalMessages, setOriginalMessages] = useState<OriginalMessage[]>([]);
  const [loadingMessages, setLoadingMessages] = useState(false);

  // Fetch snapshots
  const fetchSnapshots = async () => {
    if (!conversationId) return;

    setLoading(true);
    try {
      const res = await fetch(`/api/conversations/${conversationId}/snapshots`);
      if (res.ok) {
        const data = await res.json();
        setSnapshots(data.snapshots || []);
      }
    } catch (err) {
      console.error("Failed to fetch compression snapshots:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSnapshots();
  }, [conversationId]);

  // Fetch original messages for a snapshot
  const fetchOriginalMessages = async (snapshotId: string) => {
    setLoadingMessages(true);
    try {
      const res = await fetch(
        `/api/conversations/${conversationId}/snapshots/${snapshotId}/messages`
      );
      if (res.ok) {
        const data = await res.json();
        setOriginalMessages(data.messages || []);
        setViewingMessages(snapshotId);
      }
    } catch (err) {
      console.error("Failed to fetch original messages:", err);
    } finally {
      setLoadingMessages(false);
    }
  };

  // Format date
  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  if (loading) {
    return (
      <Box display="flex" justifyContent="center" py={4}>
        <CircularProgress size={24} />
      </Box>
    );
  }

  if (snapshots.length === 0) {
    return (
      <Box textAlign="center" py={4} color="text.secondary">
        <CompressIcon sx={{ fontSize: 40, opacity: 0.3, mb: 1 }} />
        <Typography variant="body2">No compression history</Typography>
        <Typography variant="caption">
          Conversation will be compressed when it gets too long
        </Typography>
      </Box>
    );
  }

  return (
    <Box>
      {/* Header */}
      <Box display="flex" alignItems="center" justifyContent="space-between" mb={2}>
        <Box display="flex" alignItems="center" gap={1}>
          <HistoryIcon fontSize="small" color="primary" />
          <Typography variant="subtitle2" fontWeight={600}>
            Compression History
          </Typography>
          <Chip label={`${snapshots.length} snapshots`} size="small" sx={{ height: 20, fontSize: 11 }} />
        </Box>
        <Tooltip title="Refresh">
          <IconButton size="small" onClick={fetchSnapshots}>
            <RefreshIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </Box>

      {/* Snapshot List */}
      <Box display="flex" flexDirection="column" gap={1}>
        {snapshots.map((snapshot, index) => {
          const isExpanded = expandedId === snapshot.id;
          return (
            <Paper
              key={snapshot.id}
              variant="outlined"
              sx={{
                p: 1.5,
                borderLeft: "3px solid",
                borderLeftColor: "primary.main",
              }}
            >
              {/* Header */}
              <Box
                display="flex"
                alignItems="center"
                justifyContent="space-between"
                sx={{ cursor: "pointer" }}
                onClick={() => setExpandedId(isExpanded ? null : snapshot.id)}
              >
                <Box display="flex" alignItems="center" gap={1}>
                  <CompressIcon fontSize="small" color="primary" />
                  <Typography variant="body2" fontWeight={500}>
                    Snapshot #{snapshots.length - index}
                  </Typography>
                  <Chip
                    label={`${snapshot.message_count} messages`}
                    size="small"
                    sx={{ height: 18, fontSize: 10 }}
                  />
                </Box>
                <Box display="flex" alignItems="center" gap={0.5}>
                  <Typography variant="caption" color="text.secondary">
                    {formatDate(snapshot.created_at)}
                  </Typography>
                  <IconButton size="small">
                    {isExpanded ? <ExpandLessIcon fontSize="small" /> : <ExpandMoreIcon fontSize="small" />}
                  </IconButton>
                </Box>
              </Box>

              {/* Key Topics */}
              {snapshot.key_topics && snapshot.key_topics.length > 0 && (
                <Box display="flex" gap={0.5} flexWrap="wrap" mt={1}>
                  {snapshot.key_topics.map((topic, idx) => (
                    <Chip
                      key={idx}
                      label={topic}
                      size="small"
                      color="primary"
                      variant="outlined"
                      sx={{ height: 20, fontSize: 10 }}
                    />
                  ))}
                </Box>
              )}

              {/* Summary Preview */}
              <Typography
                variant="caption"
                color="text.secondary"
                sx={{
                  display: "-webkit-box",
                  WebkitLineClamp: isExpanded ? "none" : 2,
                  WebkitBoxOrient: "vertical",
                  overflow: "hidden",
                  mt: 1,
                }}
              >
                {snapshot.summary}
              </Typography>

              {/* Expanded Details */}
              <Collapse in={isExpanded}>
                <Box mt={2} pt={1} borderTop="1px solid" borderColor="divider">
                  {/* Key Decisions */}
                  {snapshot.key_decisions && snapshot.key_decisions.length > 0 && (
                    <Box mb={1.5}>
                      <Typography variant="caption" fontWeight={500} color="text.secondary">
                        Key Decisions:
                      </Typography>
                      <Box component="ul" sx={{ m: 0, mt: 0.5, pl: 2 }}>
                        {snapshot.key_decisions.map((decision, idx) => (
                          <li key={idx}>
                            <Typography variant="caption" color="text.secondary">
                              {decision}
                            </Typography>
                          </li>
                        ))}
                      </Box>
                    </Box>
                  )}

                  {/* Token Count */}
                  {snapshot.token_count && (
                    <Typography variant="caption" color="text.disabled" display="block">
                      Compressed from ~{snapshot.token_count.toLocaleString()} tokens
                    </Typography>
                  )}

                  {/* Actions */}
                  <Box display="flex" gap={1} mt={1.5}>
                    <Button
                      size="small"
                      variant="outlined"
                      startIcon={<MessageIcon fontSize="small" />}
                      onClick={(e) => {
                        e.stopPropagation();
                        fetchOriginalMessages(snapshot.id);
                      }}
                    >
                      View Original Messages
                    </Button>
                  </Box>
                </Box>
              </Collapse>
            </Paper>
          );
        })}
      </Box>

      {/* Original Messages Dialog */}
      <Dialog
        open={!!viewingMessages}
        onClose={() => setViewingMessages(null)}
        maxWidth="md"
        fullWidth
        PaperProps={{ sx: { height: "80vh" } }}
      >
        <DialogTitle>
          <Box display="flex" alignItems="center" gap={1}>
            <MessageIcon color="primary" />
            Original Messages
          </Box>
        </DialogTitle>
        <DialogContent dividers>
          {loadingMessages ? (
            <Box display="flex" justifyContent="center" py={4}>
              <CircularProgress />
            </Box>
          ) : originalMessages.length === 0 ? (
            <Typography color="text.secondary" textAlign="center" py={4}>
              No messages found
            </Typography>
          ) : (
            <Box display="flex" flexDirection="column" gap={1}>
              {originalMessages.map((msg) => (
                <Paper
                  key={msg.id}
                  variant="outlined"
                  sx={{
                    p: 1.5,
                    bgcolor: msg.role === "assistant" ? "action.hover" : "background.paper",
                  }}
                >
                  <Box display="flex" alignItems="center" gap={1} mb={0.5}>
                    <Chip
                      label={msg.role}
                      size="small"
                      color={msg.role === "assistant" ? "primary" : "default"}
                      sx={{ height: 18, fontSize: 10 }}
                    />
                    <Typography variant="caption" color="text.disabled">
                      {formatDate(msg.created_at)}
                    </Typography>
                  </Box>
                  <Typography variant="body2" sx={{ whiteSpace: "pre-wrap" }}>
                    {msg.content}
                  </Typography>
                </Paper>
              ))}
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setViewingMessages(null)}>Close</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

