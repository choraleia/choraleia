import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Box,
  Dialog,
  DialogContent,
  DialogTitle,
  Divider,
  IconButton,
  List,
  ListItem,
  ListItemText,
  Typography,
} from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import StopIcon from "@mui/icons-material/Stop";

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

  const renderTask = (t: Task) => {
    const progress = t.progress?.total
      ? `${t.progress.done}/${t.progress.total} ${t.progress.unit || ""}`
      : "";

    const note = t.progress?.note || "";

    return (
      <ListItem
        key={t.id}
        divider
        secondaryAction={
          (t.status === "running" || t.status === "queued") && (
            <IconButton size="small" onClick={() => void cancelTask(t.id)}>
              <StopIcon fontSize="small" />
            </IconButton>
          )
        }
      >
        <ListItemText
          primary={
            <Box display="flex" alignItems="center" gap={1} minWidth={0}>
              <Typography variant="body2" noWrap sx={{ minWidth: 0 }}>
                {t.title}
              </Typography>
              <Typography variant="caption" color="text.secondary" noWrap>
                {t.status}
              </Typography>
            </Box>
          }
          secondary={
            <Typography variant="caption" color="text.secondary" noWrap>
              {progress}{note ? ` · ${note}` : ""}{t.error ? ` · ${t.error}` : ""}
            </Typography>
          }
        />
      </ListItem>
    );
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      fullWidth
      maxWidth="sm"
    >
      <DialogTitle sx={{ pr: 6 }}>
        Tasks
        <IconButton
          size="small"
          onClick={onClose}
          sx={{ position: "absolute", right: 8, top: 8 }}
        >
          <CloseIcon fontSize="small" />
        </IconButton>
      </DialogTitle>
      <DialogContent dividers sx={{ p: 0 }}>
        <Box sx={{ height: 420, display: "flex", flexDirection: "column" }}>
          {error && (
            <Box px={1.5} py={0.75}>
              <Typography variant="caption" color="error">
                {error}
              </Typography>
            </Box>
          )}

          <Box px={1.5} pt={1}>
            <Typography variant="caption" color="text.secondary">
              Active
            </Typography>
          </Box>
          <List dense disablePadding sx={{ maxHeight: 160, overflow: "auto" }}>
            {active.length ? (
              active.map(renderTask)
            ) : (
              <Box px={1.5} py={1}>
                <Typography variant="caption" color="text.secondary">
                  No active tasks
                </Typography>
              </Box>
            )}
          </List>

          <Divider />
          <Box px={1.5} pt={1}>
            <Typography variant="caption" color="text.secondary">
              History
            </Typography>
          </Box>
          <List dense disablePadding sx={{ flex: 1, overflow: "auto" }}>
            {combinedHistory.map(renderTask)}
          </List>
        </Box>
      </DialogContent>
    </Dialog>
  );
}
