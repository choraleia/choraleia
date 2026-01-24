// Memory Statistics Widget - display workspace memory stats
import React, { useState, useEffect } from "react";
import {
  Box,
  Typography,
  LinearProgress,
  CircularProgress,
  Tooltip,
} from "@mui/material";
import PsychologyIcon from "@mui/icons-material/Psychology";
import StorageIcon from "@mui/icons-material/Storage";

interface MemoryStats {
  total: number;
  by_type: Record<string, number>;
  by_scope: Record<string, number>;
  storage_bytes?: number;
  last_updated?: string;
}

interface MemoryStatsWidgetProps {
  workspaceId: string;
  compact?: boolean;
}

const TYPE_COLORS: Record<string, string> = {
  fact: "#2196f3",
  preference: "#e91e63",
  instruction: "#ff9800",
  learned: "#4caf50",
  summary: "#9c27b0",
  detail: "#607d8b",
};

const TYPE_LABELS: Record<string, string> = {
  fact: "Facts",
  preference: "Preferences",
  instruction: "Instructions",
  learned: "Learned",
  summary: "Summaries",
  detail: "Details",
};

export default function MemoryStatsWidget({
  workspaceId,
  compact = false,
}: MemoryStatsWidgetProps) {
  const [stats, setStats] = useState<MemoryStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchStats = async () => {
      if (!workspaceId) return;

      try {
        const res = await fetch(`/api/workspaces/${workspaceId}/memories/stats`);
        if (res.ok) {
          const data = await res.json();
          setStats(data);
        }
      } catch (err) {
        console.error("Failed to fetch memory stats:", err);
      } finally {
        setLoading(false);
      }
    };

    fetchStats();
  }, [workspaceId]);

  // Format storage size
  const formatBytes = (bytes?: number) => {
    if (!bytes) return "0 B";
    const units = ["B", "KB", "MB", "GB"];
    let unitIndex = 0;
    let size = bytes;
    while (size >= 1024 && unitIndex < units.length - 1) {
      size /= 1024;
      unitIndex++;
    }
    return `${size.toFixed(1)} ${units[unitIndex]}`;
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

  if (loading) {
    return (
      <Box display="flex" justifyContent="center" py={2}>
        <CircularProgress size={20} />
      </Box>
    );
  }

  if (!stats) {
    return null;
  }

  // Compact view
  if (compact) {
    return (
      <Box display="flex" alignItems="center" gap={1}>
        <PsychologyIcon fontSize="small" color="primary" />
        <Typography variant="caption" color="text.secondary">
          {stats.total} memories
        </Typography>
      </Box>
    );
  }

  // Full view
  const maxCount = Math.max(...Object.values(stats.by_type || {}), 1);

  return (
    <Box>
      {/* Header */}
      <Box display="flex" alignItems="center" gap={1} mb={2}>
        <PsychologyIcon fontSize="small" color="primary" />
        <Typography variant="subtitle2" fontWeight={600}>
          Memory Statistics
        </Typography>
      </Box>

      {/* Summary */}
      <Box display="flex" gap={2} mb={2}>
        <Box>
          <Typography variant="h5" fontWeight={600} color="primary">
            {stats.total}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            Total Memories
          </Typography>
        </Box>
        <Box>
          <Typography variant="h5" fontWeight={600}>
            {stats.by_scope?.workspace || 0}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            Workspace
          </Typography>
        </Box>
        <Box>
          <Typography variant="h5" fontWeight={600}>
            {stats.by_scope?.agent || 0}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            Agent
          </Typography>
        </Box>
      </Box>

      {/* By Type */}
      <Typography variant="caption" fontWeight={500} color="text.secondary" mb={1} display="block">
        By Type
      </Typography>
      <Box display="flex" flexDirection="column" gap={0.75} mb={2}>
        {Object.entries(TYPE_LABELS).map(([type, label]) => {
          const count = stats.by_type?.[type] || 0;
          const percent = (count / maxCount) * 100;
          return (
            <Box key={type}>
              <Box display="flex" justifyContent="space-between" mb={0.25}>
                <Typography variant="caption" color="text.secondary">
                  {label}
                </Typography>
                <Typography variant="caption" fontWeight={500}>
                  {count}
                </Typography>
              </Box>
              <Tooltip title={`${count} ${label.toLowerCase()}`}>
                <LinearProgress
                  variant="determinate"
                  value={percent}
                  sx={{
                    height: 6,
                    borderRadius: 1,
                    bgcolor: "action.hover",
                    "& .MuiLinearProgress-bar": {
                      bgcolor: TYPE_COLORS[type] || "#ccc",
                      borderRadius: 1,
                    },
                  }}
                />
              </Tooltip>
            </Box>
          );
        })}
      </Box>

      {/* Footer */}
      <Box display="flex" justifyContent="space-between" alignItems="center" pt={1} borderTop="1px solid" borderColor="divider">
        <Box display="flex" alignItems="center" gap={0.5}>
          <StorageIcon fontSize="small" sx={{ color: "text.disabled", fontSize: 14 }} />
          <Typography variant="caption" color="text.disabled">
            {formatBytes(stats.storage_bytes)}
          </Typography>
        </Box>
        <Typography variant="caption" color="text.disabled">
          Updated {formatTimeAgo(stats.last_updated)}
        </Typography>
      </Box>
    </Box>
  );
}

