// Task Center - Dialog for managing background tasks
// Uses TanStack Query for data fetching with event-driven updates

import React, { useMemo } from "react";
import {
  Box,
  Dialog,
  DialogContent,
  DialogTitle,
  IconButton,
  Typography,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Chip,
  Tooltip,
  Paper,
  LinearProgress,
} from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import StopIcon from "@mui/icons-material/Stop";
import RefreshIcon from "@mui/icons-material/Refresh";
import PlaylistPlayIcon from "@mui/icons-material/PlaylistPlay";

import { useTasks, useCancelTask, useInvalidateTasks } from "../stores";
import type { Task } from "../api/tasks";

type Props = {
  open: boolean;
  onClose: () => void;
};

export default function TaskCenter(props: Props) {
  const { open, onClose } = props;

  // Use TanStack Query for data
  const { active, history, allTasks, loading, error } = useTasks();
  const invalidate = useInvalidateTasks();
  const cancelMutation = useCancelTask();

  const handleCancel = (id: string) => {
    cancelMutation.mutate(id);
  };

  // Calculate stats
  const stats = useMemo(() => {
    const running = active.filter((t) => t.status === "running").length;
    const queued = active.filter((t) => t.status === "queued").length;
    const succeeded = history.filter((t) => t.status === "succeeded").length;
    const failed = history.filter((t) => t.status === "failed" || t.status === "canceled").length;
    return { running, queued, succeeded, failed, total: active.length + history.length };
  }, [active, history]);

  const getStatusColor = (status: string) => {
    switch (status) {
      case "running":
        return "primary";
      case "queued":
        return "warning";
      case "succeeded":
        return "success";
      case "failed":
      case "canceled":
        return "error";
      default:
        return "default";
    }
  };

  const formatTime = (dateStr?: string) => {
    if (!dateStr) return "-";
    const date = new Date(dateStr);
    return date.toLocaleTimeString("en-US", {
      hour12: false,
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  };

  const renderTaskRow = (t: Task) => {
    const hasTotal = t.progress?.total && t.progress.total > 0;
    const progress = hasTotal
      ? Math.round((t.progress.done / t.progress.total) * 100)
      : 0;

    // Format bytes for display
    const formatBytes = (bytes: number): string => {
      if (bytes < 1024) return `${bytes} B`;
      if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
      if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
      return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
    };

    const getProgressText = (): string => {
      if (hasTotal) {
        return `${t.progress.done}/${t.progress.total} ${t.progress.unit || ""}`;
      }
      // When total is unknown, show done value
      if (t.progress?.done > 0) {
        if (t.progress.unit === "bytes") {
          return formatBytes(t.progress.done);
        }
        return `${t.progress.done} ${t.progress.unit || ""}`;
      }
      // Show note if available
      if (t.progress?.note) {
        return t.progress.note;
      }
      return "";
    };

    const progressText = getProgressText();

    return (
      <TableRow key={t.id} hover>
        <TableCell>
          <Tooltip title={t.title}>
            <Typography variant="body2" noWrap sx={{ maxWidth: 200 }}>
              {t.title}
            </Typography>
          </Tooltip>
        </TableCell>
        <TableCell>
          <Chip
            size="small"
            label={t.status}
            color={getStatusColor(t.status) as any}
            sx={{ height: 20, fontSize: 11 }}
          />
        </TableCell>
        <TableCell sx={{ minWidth: 120 }}>
          {t.status === "running" && hasTotal ? (
            <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
              <LinearProgress
                variant="determinate"
                value={progress}
                sx={{ flex: 1, height: 6, borderRadius: 1 }}
              />
              <Typography variant="caption" sx={{ fontSize: 10, minWidth: 35 }}>
                {progress}%
              </Typography>
            </Box>
          ) : t.status === "running" && t.progress?.done > 0 ? (
            <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
              <LinearProgress
                variant="indeterminate"
                sx={{ flex: 1, height: 6, borderRadius: 1 }}
              />
              <Typography variant="caption" sx={{ fontSize: 10, minWidth: 50 }} noWrap>
                {progressText}
              </Typography>
            </Box>
          ) : (
            <Typography variant="caption" color="text.secondary" noWrap>
              {progressText || (t.status === "running" ? "Starting..." : "-")}
            </Typography>
          )}
        </TableCell>
        <TableCell>
          <Typography variant="body2" sx={{ fontSize: 11 }}>
            {formatTime(t.created_at)}
          </Typography>
        </TableCell>
        <TableCell align="right">
          {(t.status === "running" || t.status === "queued") && (
            <Tooltip title="Cancel">
              <IconButton size="small" onClick={() => handleCancel(t.id)}>
                <StopIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          )}
        </TableCell>
      </TableRow>
    );
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle sx={{ display: "flex", alignItems: "center", py: 1.5 }}>
        <PlaylistPlayIcon sx={{ mr: 1 }} />
        <Typography variant="h6" component="span" sx={{ flex: 1 }}>
          Task Center
        </Typography>
        <IconButton size="small" onClick={() => invalidate()} disabled={loading}>
          <RefreshIcon fontSize="small" />
        </IconButton>
        <IconButton size="small" onClick={onClose} sx={{ ml: 1 }}>
          <CloseIcon fontSize="small" />
        </IconButton>
      </DialogTitle>
      <DialogContent dividers sx={{ p: 0 }}>
        {/* Stats Summary */}
        <Box
          sx={{
            display: "flex",
            gap: 3,
            px: 2,
            py: 1,
            bgcolor: "background.default",
            borderBottom: "1px solid",
            borderColor: "divider",
          }}
        >
          <Box sx={{ display: "flex", alignItems: "baseline", gap: 0.5 }}>
            <Typography variant="body2" fontWeight={600} color="primary.main">
              {stats.running}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              Running
            </Typography>
          </Box>
          <Box sx={{ display: "flex", alignItems: "baseline", gap: 0.5 }}>
            <Typography variant="body2" fontWeight={600} color="warning.main">
              {stats.queued}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              Queued
            </Typography>
          </Box>
          <Box sx={{ display: "flex", alignItems: "baseline", gap: 0.5 }}>
            <Typography variant="body2" fontWeight={600} color="success.main">
              {stats.succeeded}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              Succeeded
            </Typography>
          </Box>
          <Box sx={{ display: "flex", alignItems: "baseline", gap: 0.5 }}>
            <Typography variant="body2" fontWeight={600} color="error.main">
              {stats.failed}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              Failed
            </Typography>
          </Box>
        </Box>

        {error && (
          <Box px={2} py={1} bgcolor="error.light">
            <Typography variant="caption" color="error.contrastText">
              {error instanceof Error ? error.message : String(error)}
            </Typography>
          </Box>
        )}

        {/* Task List */}
        <TableContainer component={Paper} elevation={0} sx={{ maxHeight: 400 }}>
          <Table size="small" stickyHeader>
            <TableHead>
              <TableRow>
                <TableCell>Task</TableCell>
                <TableCell sx={{ width: 90 }}>Status</TableCell>
                <TableCell sx={{ width: 140 }}>Progress</TableCell>
                <TableCell sx={{ width: 80 }}>Time</TableCell>
                <TableCell sx={{ width: 50 }} align="right">
                  Actions
                </TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {loading && allTasks.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} align="center" sx={{ py: 4 }}>
                    <Typography color="text.secondary">Loading...</Typography>
                  </TableCell>
                </TableRow>
              ) : allTasks.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} align="center" sx={{ py: 4 }}>
                    <Typography color="text.secondary">No tasks</Typography>
                  </TableCell>
                </TableRow>
              ) : (
                allTasks.map(renderTaskRow)
              )}
            </TableBody>
          </Table>
        </TableContainer>
      </DialogContent>
    </Dialog>
  );
}

