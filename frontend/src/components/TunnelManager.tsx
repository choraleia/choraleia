// filepath: /home/blue/codes/choraleia/frontend/src/components/TunnelManager.tsx
import React, { useState, useEffect, useCallback } from "react";
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
import { getApiUrl } from "../api/base";

export interface TunnelInfo {
  id: string;
  asset_id: string;
  asset_name: string;
  type: "local" | "remote" | "dynamic";
  local_host: string;
  local_port: number;
  remote_host?: string;
  remote_port?: number;
  status: "running" | "stopped" | "error";
  error_message?: string;
  bytes_sent?: number;
  bytes_received?: number;
  connections?: number;
  started_at?: string;
}

export interface TunnelStats {
  total: number;
  running: number;
  stopped: number;
  error: number;
  total_bytes_sent: number;
  total_bytes_received: number;
}

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
  const [tunnels, setTunnels] = useState<TunnelInfo[]>([]);
  const [stats, setStats] = useState<TunnelStats>({
    total: 0,
    running: 0,
    stopped: 0,
    error: 0,
    total_bytes_sent: 0,
    total_bytes_received: 0,
  });
  const [loading, setLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const fetchTunnels = useCallback(async () => {
    setLoading(true);
    try {
      const resp = await fetch(getApiUrl("/api/tunnels"));
      const data = await resp.json();
      if (data.code === 200 && data.data) {
        setTunnels(data.data.tunnels || []);
        setStats(data.data.stats || {
          total: 0,
          running: 0,
          stopped: 0,
          error: 0,
          total_bytes_sent: 0,
          total_bytes_received: 0,
        });
      }
    } catch (e) {
      console.error("Failed to fetch tunnels:", e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) {
      fetchTunnels();
      // Auto refresh every 5 seconds
      const interval = setInterval(fetchTunnels, 5000);
      return () => clearInterval(interval);
    }
  }, [open, fetchTunnels]);

  const handleStart = async (tunnelId: string) => {
    setActionLoading(tunnelId);
    try {
      const resp = await fetch(getApiUrl(`/api/tunnels/${tunnelId}/start`), {
        method: "POST",
      });
      const data = await resp.json();
      if (data.code === 200) {
        fetchTunnels();
      }
    } catch (e) {
      console.error("Failed to start tunnel:", e);
    } finally {
      setActionLoading(null);
    }
  };

  const handleStop = async (tunnelId: string) => {
    setActionLoading(tunnelId);
    try {
      const resp = await fetch(getApiUrl(`/api/tunnels/${tunnelId}/stop`), {
        method: "POST",
      });
      const data = await resp.json();
      if (data.code === 200) {
        fetchTunnels();
      }
    } catch (e) {
      console.error("Failed to stop tunnel:", e);
    } finally {
      setActionLoading(null);
    }
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
        <IconButton size="small" onClick={fetchTunnels} disabled={loading}>
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
                      <Typography variant="caption" sx={{ fontSize: 11 }}>
                        ↑{formatBytes(tunnel.bytes_sent || 0)}
                        <br />
                        ↓{formatBytes(tunnel.bytes_received || 0)}
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

