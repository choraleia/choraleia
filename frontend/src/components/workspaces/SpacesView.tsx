import React, { useMemo, useState, useCallback } from "react";
import {
  Box,
  Button,
  Card,
  CardActionArea,
  CardContent,
  Chip,
  Grid,
  Stack,
  Typography,
  IconButton,
  Tooltip,
  Menu,
  MenuItem,
  ListItemIcon,
  ListItemText,
  Divider,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogContentText,
  DialogActions,
  CircularProgress,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import StopIcon from "@mui/icons-material/Stop";
import ComputerIcon from "@mui/icons-material/Computer";
import ViewInArIcon from "@mui/icons-material/ViewInAr";
import CloudIcon from "@mui/icons-material/Cloud";
import MoreVertIcon from "@mui/icons-material/MoreVert";
import EditIcon from "@mui/icons-material/Edit";
import DeleteIcon from "@mui/icons-material/Delete";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import DashboardIcon from "@mui/icons-material/Dashboard";
import BuildIcon from "@mui/icons-material/Build";
import FolderIcon from "@mui/icons-material/Folder";
import SpaceLayout from "./SpaceLayout";
import { Workspace, useWorkspaces, createRoomConfigTemplate, SpaceConfigInput, RuntimeType } from "../../state/workspaces";
import SpaceConfigDialog from "./SpaceConfigDialog";

const statusColors: Record<string, "success" | "default" | "warning" | "error"> = {
  running: "success",
  stopped: "default",
  starting: "warning",
  stopping: "warning",
  error: "error",
};

// Detailed status response type
type RuntimeDetailedStatus = {
  workspace_id: string;
  phase: string;
  message?: string;
  progress?: number;
  error?: string;
  container_id?: string;
  container_name?: string;
  container_status?: string;
  container_image?: string;
  started_at?: string;
  last_updated_at: string;
  resources?: {
    cpu_percent: number;
    memory_percent: number;
    memory_usage: number;
    memory_limit: number;
  };
};

type WorkspaceStatusResponse = {
  status: string;
  runtime?: {
    type: string;
    container_id?: string;
    container_status?: string;
    uptime?: number;
  };
  runtime_detailed?: RuntimeDetailedStatus;
};

// Status chip with tooltip that shows detailed status on hover
const StatusChipWithTooltip: React.FC<{ workspace: Workspace }> = ({ workspace }) => {
  const [detailedStatus, setDetailedStatus] = useState<WorkspaceStatusResponse | null>(null);
  const [loading, setLoading] = useState(false);

  const fetchDetailedStatus = useCallback(async () => {
    if (loading) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/workspaces/${workspace.id}/status`);
      if (res.ok) {
        const data = await res.json();
        setDetailedStatus(data);
      }
    } catch (err) {
      console.error("Failed to fetch workspace status:", err);
    } finally {
      setLoading(false);
    }
  }, [workspace.id, loading]);

  const handleMouseEnter = () => {
    fetchDetailedStatus();
  };

  const formatUptime = (seconds?: number) => {
    if (!seconds) return "N/A";
    if (seconds < 60) return `${seconds}s`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
    const hours = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    return `${hours}h ${mins}m`;
  };

  const formatBytes = (bytes?: number) => {
    if (!bytes) return "N/A";
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  };

  const detailed = detailedStatus?.runtime_detailed;
  const runtime = detailedStatus?.runtime;

  const tooltipContent = (
    <Box sx={{ p: 0.5, minWidth: 180, maxWidth: 320 }}>
      {loading && !detailedStatus ? (
        <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
          <CircularProgress size={12} />
          <Typography variant="caption">Loading...</Typography>
        </Box>
      ) : (
        <>
          <Typography variant="caption" fontWeight={600} display="block" gutterBottom>
            Status: {workspace.status}
          </Typography>

          {detailed?.phase && detailed.phase !== "idle" && (
            <Typography variant="caption" display="block">
              Phase: {detailed.phase}
            </Typography>
          )}

          {detailed?.message && (
            <Typography variant="caption" display="block">
              {detailed.message}
            </Typography>
          )}

          {detailed?.progress !== undefined && detailed.progress > 0 && detailed.progress < 100 && (
            <Typography variant="caption" display="block">
              Progress: {detailed.progress}%
            </Typography>
          )}

          {detailed?.error && (
            <Typography
              variant="caption"
              display="block"
              sx={{
                wordBreak: "break-word",
                whiteSpace: "pre-wrap",
              }}
            >
              Error: {detailed.error}
            </Typography>
          )}

          {(detailed?.container_name || runtime?.container_id) && (
            <Typography variant="caption" display="block" sx={{ fontFamily: "monospace" }}>
              Container: {detailed?.container_name || runtime?.container_id?.slice(0, 12)}
            </Typography>
          )}

          {runtime?.uptime !== undefined && runtime.uptime > 0 && (
            <Typography variant="caption" display="block">
              Uptime: {formatUptime(runtime.uptime)}
            </Typography>
          )}

          {detailed?.resources && (
            <>
              <Divider sx={{ my: 0.5 }} />
              <Typography variant="caption" display="block">
                CPU: {detailed.resources.cpu_percent.toFixed(1)}%
              </Typography>
              <Typography variant="caption" display="block">
                Memory: {formatBytes(detailed.resources.memory_usage)} / {formatBytes(detailed.resources.memory_limit)} ({detailed.resources.memory_percent.toFixed(1)}%)
              </Typography>
            </>
          )}

          {detailed?.last_updated_at && (
            <Typography variant="caption" display="block" color="text.disabled" sx={{ mt: 0.5, fontSize: "0.6rem" }}>
              Updated: {new Date(detailed.last_updated_at).toLocaleTimeString()}
            </Typography>
          )}

          {!detailed && !runtime && !loading && (
            <Typography variant="caption">
              No detailed status available
            </Typography>
          )}
        </>
      )}
    </Box>
  );

  return (
    <Tooltip
      title={tooltipContent}
      arrow
      placement="top"
      onOpen={handleMouseEnter}
      slotProps={{
        tooltip: {
          sx: {
            bgcolor: "background.paper",
            color: "text.primary",
            boxShadow: 2,
            "& .MuiTooltip-arrow": {
              color: "background.paper",
            },
            maxWidth: 360,
          },
        },
      }}
    >
      <Chip
        size="small"
        label={workspace.status}
        color={statusColors[workspace.status] || "default"}
        sx={{ height: 20, fontSize: "0.7rem" }}
        onClick={(e) => e.stopPropagation()}
      />
    </Tooltip>
  );
};

// Check if workspace has start/stop capability (only Docker workspaces)
const canStartStop = (type: RuntimeType) => type !== "local";

const runtimeIcon = (type: RuntimeType) => {
  switch (type) {
    case "local":
      return <ComputerIcon fontSize="small" />;
    case "docker-local":
      return <ViewInArIcon fontSize="small" />;
    case "docker-remote":
      return <CloudIcon fontSize="small" />;
  }
};

const runtimeLabel = (type: RuntimeType) => {
  switch (type) {
    case "local":
      return "Local";
    case "docker-local":
      return "Docker (Local)";
    case "docker-remote":
      return "Docker (Remote)";
  }
};

const SpacesView: React.FC = () => {
  const {
    workspaces,
    activeWorkspaceId,
    selectWorkspace,
    createWorkspaceWithConfig,
    updateWorkspaceConfig,
    deleteWorkspace,
    startWorkspace,
    stopWorkspace,
  } = useWorkspaces();

  const [viewMode, setViewMode] = useState<"overview" | "workspace">("overview");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingWorkspace, setEditingWorkspace] = useState<Workspace | null>(null);

  // Menu state
  const [menuAnchor, setMenuAnchor] = useState<null | HTMLElement>(null);
  const [menuWorkspace, setMenuWorkspace] = useState<Workspace | null>(null);

  // Delete confirmation dialog
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [workspaceToDelete, setWorkspaceToDelete] = useState<Workspace | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const activeWorkspace = useMemo(
    () => workspaces.find((ws) => ws.id === activeWorkspaceId),
    [workspaces, activeWorkspaceId],
  );

  const dialogInitialConfig = useMemo(() => {
    if (editingWorkspace) {
      return {
        name: editingWorkspace.name,
        description: editingWorkspace.description,
        runtime: editingWorkspace.runtime,
        assets: editingWorkspace.assets,
        tools: editingWorkspace.tools,
      };
    }
    return createRoomConfigTemplate(`workspace-${workspaces.length + 1}`);
  }, [editingWorkspace, workspaces.length]);

  const enterWorkspace = (workspaceId: string) => {
    selectWorkspace(workspaceId);
    setViewMode("workspace");
  };

  const backToOverview = () => setViewMode("overview");

  const handleNewSpace = () => {
    setEditingWorkspace(null);
    setDialogOpen(true);
  };

  const handleMenuOpen = (event: React.MouseEvent<HTMLElement>, workspace: Workspace) => {
    event.stopPropagation();
    setMenuAnchor(event.currentTarget);
    setMenuWorkspace(workspace);
  };

  const handleMenuClose = () => {
    setMenuAnchor(null);
    setMenuWorkspace(null);
  };

  const handleEditWorkspace = () => {
    if (menuWorkspace) {
      setEditingWorkspace(menuWorkspace);
      setDialogOpen(true);
    }
    handleMenuClose();
  };

  const handleDeleteClick = () => {
    if (menuWorkspace) {
      setWorkspaceToDelete(menuWorkspace);
      setDeleteDialogOpen(true);
    }
    handleMenuClose();
  };

  const handleDeleteConfirm = async () => {
    if (!workspaceToDelete) return;

    setIsDeleting(true);
    try {
      await deleteWorkspace(workspaceToDelete.id);
    } catch (err) {
      console.error("Failed to delete workspace:", err);
    } finally {
      setIsDeleting(false);
      setDeleteDialogOpen(false);
      setWorkspaceToDelete(null);
    }
  };

  const handleStartStop = async (workspace: Workspace) => {
    handleMenuClose();
    try {
      if (workspace.status === "running") {
        await stopWorkspace(workspace.id);
      } else {
        await startWorkspace(workspace.id);
      }
    } catch (err) {
      console.error("Failed to start/stop workspace:", err);
    }
  };

  const handleDialogClose = () => setDialogOpen(false);

  const handleDialogSave = (config: SpaceConfigInput) => {
    if (editingWorkspace) {
      updateWorkspaceConfig(editingWorkspace.id, config);
    } else {
      createWorkspaceWithConfig(config);
    }
    setDialogOpen(false);
  };

  if (viewMode === "workspace" && activeWorkspace) {
    return (
      <Box display="flex" flexDirection="column" flex={1} minHeight={0}>
        <SpaceLayout onBackToOverview={backToOverview} />
      </Box>
    );
  }

  return (
    <Box flex={1} display="flex" flexDirection="column" minHeight={0} px={2} py={1.5}>
      <Stack direction="row" alignItems="center" spacing={1.5} mb={2}>
        <Box>
          <Typography variant="h6">Workspaces</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.25 }}>
            Isolated environments for different projects and workflows
          </Typography>
        </Box>
        <Box flex={1} />
        <Button
          variant="contained"
          startIcon={<AddIcon fontSize="small" />}
          onClick={handleNewSpace}
          size="small"
        >
          New Workspace
        </Button>
      </Stack>

      <Grid container spacing={2} alignContent="flex-start">
        {workspaces.map((workspace) => {
          const isActive = workspace.id === activeWorkspaceId;
          const toolsCount = workspace.tools.length;
          const assetsCount = workspace.assets.assets.length;

          return (
            <Grid item key={workspace.id} xs={12} sm={6} md={4} lg={3}>
              <Card
                variant={isActive ? "elevation" : "outlined"}
                sx={{
                  borderRadius: 2,
                  position: "relative",
                  borderLeft: isActive ? `3px solid ${workspace.color}` : undefined,
                  "&:hover": {
                    boxShadow: 2,
                  },
                }}
              >
                {/* Menu button */}
                <IconButton
                  size="small"
                  sx={{ position: "absolute", top: 8, right: 8, zIndex: 1 }}
                  onClick={(e) => handleMenuOpen(e, workspace)}
                >
                  <MoreVertIcon fontSize="small" />
                </IconButton>

                <CardActionArea onClick={() => enterWorkspace(workspace.id)}>
                  <CardContent sx={{ p: 2, pr: 5 }}>
                    <Stack spacing={1}>
                      {/* Title and status */}
                      <Stack direction="row" spacing={1} alignItems="center">
                        <Typography variant="subtitle1" fontWeight={600} noWrap sx={{ flex: 1 }}>
                          {workspace.name}
                        </Typography>
                        {canStartStop(workspace.runtime.type) && (
                          <StatusChipWithTooltip workspace={workspace} />
                        )}
                      </Stack>

                      {/* Description */}
                      {workspace.description && (
                        <Typography
                          variant="body2"
                          color="text.secondary"
                          sx={{
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            display: "-webkit-box",
                            WebkitLineClamp: 2,
                            WebkitBoxOrient: "vertical",
                            minHeight: 40,
                          }}
                        >
                          {workspace.description}
                        </Typography>
                      )}

                      {/* Runtime info */}
                      <Stack direction="row" spacing={0.5} alignItems="center">
                        {runtimeIcon(workspace.runtime.type)}
                        <Typography variant="caption" color="text.secondary">
                          {runtimeLabel(workspace.runtime.type)}
                        </Typography>
                      </Stack>

                      {/* Metadata chips */}
                      <Stack direction="row" spacing={0.5} flexWrap="wrap" gap={0.5}>
                        <Tooltip title="Rooms">
                          <Chip
                            size="small"
                            icon={<DashboardIcon sx={{ fontSize: 14 }} />}
                            label={workspace.rooms.length}
                            variant="outlined"
                            sx={{ height: 22, fontSize: "0.7rem" }}
                          />
                        </Tooltip>
                        {toolsCount > 0 && (
                          <Tooltip title="Tools">
                            <Chip
                              size="small"
                              icon={<BuildIcon sx={{ fontSize: 14 }} />}
                              label={toolsCount}
                              variant="outlined"
                              sx={{ height: 22, fontSize: "0.7rem" }}
                            />
                          </Tooltip>
                        )}
                        {assetsCount > 0 && (
                          <Tooltip title="Assets">
                            <Chip
                              size="small"
                              icon={<FolderIcon sx={{ fontSize: 14 }} />}
                              label={assetsCount}
                              variant="outlined"
                              sx={{ height: 22, fontSize: "0.7rem" }}
                            />
                          </Tooltip>
                        )}
                      </Stack>

                      {/* Work directory */}
                      {workspace.runtime.workDir.path && (
                        <Typography
                          variant="caption"
                          color="text.disabled"
                          noWrap
                          sx={{ fontFamily: "monospace", fontSize: "0.65rem" }}
                        >
                          {workspace.runtime.workDir.path}
                        </Typography>
                      )}
                    </Stack>
                  </CardContent>
                </CardActionArea>
              </Card>
            </Grid>
          );
        })}

        {workspaces.length === 0 && (
          <Grid item xs={12}>
            <Stack spacing={1} alignItems="center" py={4}>
              <Typography variant="subtitle1">No workspaces yet</Typography>
              <Typography variant="body2" color="text.secondary" textAlign="center">
                Create a workspace to group assets, chats, and tools for a workflow.
              </Typography>
              <Button
                variant="outlined"
                startIcon={<AddIcon fontSize="small" />}
                onClick={handleNewSpace}
                size="small"
              >
                Create Workspace
              </Button>
            </Stack>
          </Grid>
        )}
      </Grid>

      {/* Context Menu */}
      <Menu
        anchorEl={menuAnchor}
        open={Boolean(menuAnchor)}
        onClose={handleMenuClose}
        anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
        transformOrigin={{ vertical: "top", horizontal: "right" }}
      >
        <MenuItem onClick={handleEditWorkspace}>
          <ListItemIcon>
            <EditIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText primaryTypographyProps={{ variant: "body2" }}>Edit</ListItemText>
        </MenuItem>
        {menuWorkspace && canStartStop(menuWorkspace.runtime.type) && (
          <MenuItem onClick={() => handleStartStop(menuWorkspace)}>
            <ListItemIcon>
              {menuWorkspace.status === "running" ? (
                <StopIcon fontSize="small" />
              ) : (
                <PlayArrowIcon fontSize="small" />
              )}
            </ListItemIcon>
            <ListItemText primaryTypographyProps={{ variant: "body2" }}>
              {menuWorkspace.status === "running" ? "Stop" : "Start"}
            </ListItemText>
          </MenuItem>
        )}
        <Divider />
        <MenuItem onClick={handleDeleteClick}>
          <ListItemIcon>
            <DeleteIcon fontSize="small" color="error" />
          </ListItemIcon>
          <ListItemText
            primaryTypographyProps={{ variant: "body2", color: "error" }}
          >
            Delete
          </ListItemText>
        </MenuItem>
      </Menu>

      {/* Delete Confirmation Dialog */}
      <Dialog open={deleteDialogOpen} onClose={() => setDeleteDialogOpen(false)}>
        <DialogTitle>Delete Workspace</DialogTitle>
        <DialogContent>
          <DialogContentText>
            Are you sure you want to delete workspace "{workspaceToDelete?.name}"?
            This action cannot be undone.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteDialogOpen(false)} disabled={isDeleting}>
            Cancel
          </Button>
          <Button
            onClick={handleDeleteConfirm}
            color="error"
            variant="contained"
            disabled={isDeleting}
          >
            {isDeleting ? "Deleting..." : "Delete"}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Create/Edit Dialog */}
      <SpaceConfigDialog
        open={dialogOpen}
        onClose={handleDialogClose}
        initialConfig={dialogInitialConfig}
        onSave={handleDialogSave}
        existingNames={workspaces.map(ws => ws.name)}
        editingName={editingWorkspace?.name}
      />
    </Box>
  );
};

export default SpacesView;
