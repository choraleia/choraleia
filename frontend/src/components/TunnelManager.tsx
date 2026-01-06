// Tunnel Manager - Dialog for managing SSH tunnels
// Uses TanStack Query for data fetching with event-driven updates

import React from "react";
import {
  Dialog,
  DialogTitle,
  DialogContent,
  Box,
  Typography,
  IconButton,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Chip,
  Tooltip,
  Paper,
  CircularProgress,
} from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import StopIcon from "@mui/icons-material/Stop";
import RefreshIcon from "@mui/icons-material/Refresh";
import SwapHorizIcon from "@mui/icons-material/SwapHoriz";

import {
  useTunnels,
  useStartTunnel,
  useStopTunnel,
  useInvalidateTunnels,
} from "../stores";
import type { TunnelInfo } from "../api/tunnels";

// Re-export types for backward compatibility
export type { TunnelInfo, TunnelStats } from "../api/tunnels";

interface TunnelManagerProps {
  open: boolean;
  onClose: () => void;
}

// Format bytes to human readable
function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
}

// Format duration from ISO string
function formatDuration(startedAt?: string): string {
  if (!startedAt) return "-";
  const start = new Date(startedAt).getTime();
  const now = Date.now();
  const seconds = Math.floor((now - start) / 1000);

  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  const hours = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  return `${hours}h ${mins}m`;
}

const TunnelManager: React.FC<TunnelManagerProps> = ({ open, onClose }) => {
  // Use TanStack Query for data
  const { tunnels, stats, loading } = useTunnels();
  const invalidate = useInvalidateTunnels();

  // Mutations for start/stop - invalidate on error to show error in status tooltip
  const startMutation = useStartTunnel();
  const stopMutation = useStopTunnel();

  const actionLoading = startMutation.isPending || stopMutation.isPending
    ? (startMutation.variables || stopMutation.variables)
    : null;

  const handleStart = (tunnelId: string) => {
    startMutation.mutate(tunnelId, {
      onError: () => {
        // Refresh list to get updated error status
        invalidate();
      },
    });
  };

  const handleStop = (tunnelId: string) => {
    stopMutation.mutate(tunnelId, {
      onError: () => {
        // Refresh list to get updated error status
        invalidate();
      },
    });
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "running":
        return "success";
      case "stopped":
        return "default";
      case "error":
        return "error";
      default:
        return "default";
    }
  };

  const getTunnelLabel = (tunnel: TunnelInfo) => {
    if (tunnel.type === "dynamic") {
      return `${tunnel.local_host}:${tunnel.local_port}`;
    }
    if (tunnel.type === "local") {
      return `${tunnel.local_host}:${tunnel.local_port} → ${tunnel.remote_host}:${tunnel.remote_port}`;
    }
    // remote
    return `${tunnel.remote_host}:${tunnel.remote_port} → ${tunnel.local_host}:${tunnel.local_port}`;
  };

  const getTypeLabel = (type: string) => {
    switch (type) {
      case "local":
        return "L";
      case "remote":
        return "R";
      case "dynamic":
        return "D";
      default:
        return "?";
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle sx={{ display: "flex", alignItems: "center", py: 1.5 }}>
        <SwapHorizIcon sx={{ mr: 1 }} />
        <Typography variant="h6" component="span" sx={{ flex: 1 }}>
          Tunnel Manager
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
            <Typography variant="body2" fontWeight={600}>
              {stats.total}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              Total
            </Typography>
          </Box>
          <Box sx={{ display: "flex", alignItems: "baseline", gap: 0.5 }}>
            <Typography variant="body2" fontWeight={600} color="success.main">
              {stats.running}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              Running
            </Typography>
          </Box>
          <Box sx={{ display: "flex", alignItems: "baseline", gap: 0.5 }}>
            <Typography variant="body2" fontWeight={600} color="text.secondary">
              {stats.stopped}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              Stopped
            </Typography>
          </Box>
          <Box sx={{ display: "flex", alignItems: "baseline", gap: 0.5 }}>
            <Typography variant="body2" fontWeight={600} color="error.main">
              {stats.error}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              Error
            </Typography>
          </Box>
          <Box sx={{ ml: "auto", display: "flex", alignItems: "baseline", gap: 0.5 }}>
            <Typography variant="caption" color="text.secondary">
              Traffic
            </Typography>
            <Typography variant="body2" sx={{ fontSize: 12 }}>
              ↑{formatBytes(stats.total_bytes_sent)} ↓{formatBytes(stats.total_bytes_received)}
            </Typography>
          </Box>
        </Box>

        {/* Tunnel List */}
        <TableContainer component={Paper} elevation={0}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell sx={{ width: 50 }}>Type</TableCell>
                <TableCell>Asset</TableCell>
                <TableCell>Tunnel</TableCell>
                <TableCell sx={{ width: 80 }}>Status</TableCell>
                <TableCell sx={{ width: 100 }}>Traffic</TableCell>
                <TableCell sx={{ width: 80 }}>Uptime</TableCell>
                <TableCell sx={{ width: 80 }} align="right">
                  Actions
                </TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {loading && tunnels.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} align="center" sx={{ py: 4 }}>
                    <CircularProgress size={24} />
                  </TableCell>
                </TableRow>
              ) : tunnels.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} align="center" sx={{ py: 4 }}>
                    <Typography color="text.secondary">
                      No tunnels configured
                    </Typography>
                  </TableCell>
                </TableRow>
              ) : (
                tunnels.map((tunnel) => (
                  <TableRow key={tunnel.id} hover>
                    <TableCell>
                      <Chip
                        size="small"
                        label={getTypeLabel(tunnel.type)}
                        sx={{
                          minWidth: 28,
                          height: 20,
                          fontSize: 11,
                          fontWeight: 600,
                        }}
                      />
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2" noWrap>
                        {tunnel.asset_name}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Tooltip title={getTunnelLabel(tunnel)}>
                        <Typography
                          variant="body2"
                          sx={{ fontFamily: "monospace", fontSize: 12 }}
                          noWrap
                        >
                          {getTunnelLabel(tunnel)}
                        </Typography>
                      </Tooltip>
                    </TableCell>
                    <TableCell>
                      <Tooltip title={tunnel.error_message || ""}>
                        <Chip
                          size="small"
                          label={tunnel.status}
                          color={getStatusColor(tunnel.status) as any}
                          sx={{ height: 20, fontSize: 11 }}
                        />
                      </Tooltip>
                    </TableCell>
                    <TableCell>
                      <Typography variant="caption" sx={{ fontSize: 11, whiteSpace: "nowrap" }}>
                        ↑{formatBytes(tunnel.bytes_sent || 0)} ↓{formatBytes(tunnel.bytes_received || 0)}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2" sx={{ fontSize: 11 }}>
                        {formatDuration(tunnel.started_at)}
                      </Typography>
                    </TableCell>
                    <TableCell align="right">
                      {actionLoading === tunnel.id ? (
                        <CircularProgress size={16} />
                      ) : tunnel.status === "running" ? (
                        <Tooltip title="Stop">
                          <IconButton
                            size="small"
                            onClick={() => handleStop(tunnel.id)}
                          >
                            <StopIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      ) : (
                        <Tooltip title="Start">
                          <IconButton
                            size="small"
                            onClick={() => handleStart(tunnel.id)}
                            color="primary"
                          >
                            <PlayArrowIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      )}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </TableContainer>
      </DialogContent>
    </Dialog>
  );
};

export default TunnelManager;

