import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
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

import { Task, tasksCancel } from "../api/tasks";
import { tasksWSClient } from "../api/tasks_ws_client";
import { tasksStore } from "../api/tasks_store";

type Props = {
  open: boolean;
  onClose: () => void;
};

function sortByTimeDesc(tasks: Task[]): Task[] {
  return [...tasks].sort((a, b) => {
    const ta = Date.parse(a.created_at || "") || 0;
    const tb = Date.parse(b.created_at || "") || 0;
    return tb - ta;
  });
}

export default function TaskCenter(props: Props) {
  const { open, onClose } = props;

  const [active, setActive] = useState<Task[]>([]);
  const [history, setHistory] = useState<Task[]>([]);
  const [error, setError] = useState<string | null>(null);

  const unsubStoreRef = useRef<(() => void) | null>(null);

  const unsubRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!open) return;
    if (unsubStoreRef.current) return;

    // Subscribe to the in-memory store, which is fueled by the WS list-watch stream.
    unsubStoreRef.current = tasksStore.subscribe((s) => {
      setActive(s.active);
      setHistory(s.history);
    });

    return () => {
      unsubStoreRef.current?.();
      unsubStoreRef.current = null;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    if (unsubRef.current) return;

    // Subscribe to task events while the modal is open.
    // The underlying WS connection is managed globally by tasksWSClient.
    const unsub = tasksWSClient.subscribe(() => {
      // No-op: the store subscription drives UI updates.
    });
    unsubRef.current = unsub;

    const unsubState = tasksWSClient.subscribeState((s) => {
      if (s.status === "open") {
        setError(null);
      } else if (s.status === "closed" && s.error) {
        setError((prev) => prev ?? s.error!);
      }
    });

    return () => {
      unsub();
      unsubState();
      unsubRef.current = null;
    };
  }, [open]);

  const combinedHistory = useMemo(() => {
    const all = [...active, ...history];
    const byId = new Map<string, Task>();
    for (const t of all) byId.set(t.id, t);
    return sortByTimeDesc(Array.from(byId.values()));
  }, [active, history]);

  const cancelTask = useCallback(async (id: string) => {
    try {
      await tasksCancel(id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

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
    const progress = t.progress?.total
      ? Math.round((t.progress.done / t.progress.total) * 100)
      : 0;
    const progressText = t.progress?.total
      ? `${t.progress.done}/${t.progress.total} ${t.progress.unit || ""}`
      : "";

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
          {t.status === "running" && t.progress?.total ? (
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
          ) : (
            <Typography variant="caption" color="text.secondary">
              {progressText || "-"}
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
              <IconButton size="small" onClick={() => void cancelTask(t.id)}>
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
        <IconButton size="small" disabled>
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
              {error}
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
              {combinedHistory.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} align="center" sx={{ py: 4 }}>
                    <Typography color="text.secondary">No tasks</Typography>
                  </TableCell>
                </TableRow>
              ) : (
                combinedHistory.map(renderTaskRow)
              )}
            </TableBody>
          </Table>
        </TableContainer>
      </DialogContent>
    </Dialog>
  );
}
