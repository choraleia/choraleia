import React, { useMemo, useState } from "react";
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
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import PauseIcon from "@mui/icons-material/Pause";
import SpaceLayout from "./SpaceLayout";
import { Workspace, useWorkspaces, createSpaceConfigTemplate, SpaceConfigInput } from "../../state/workspaces";
import SpaceConfigDialog from "./SpaceConfigDialog";
import SettingsIcon from "@mui/icons-material/Settings";

const statusChip = (workspace: Workspace) => {
  const icon = workspace.status === "running" ? <PlayArrowIcon fontSize="small" /> : <PauseIcon fontSize="small" />;
  const color = workspace.status === "running" ? "success" : "default";
  return <Chip size="small" icon={icon} label={workspace.status} color={color} />;
};

const SpacesView: React.FC = () => {
  const {
    workspaces,
    activeWorkspaceId,
    selectWorkspace,
    createWorkspace,
    createWorkspaceWithConfig,
    updateWorkspaceConfig,
  } = useWorkspaces();
  const [viewMode, setViewMode] = useState<"overview" | "workspace">("overview");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingWorkspace, setEditingWorkspace] = useState<Workspace | null>(null);

  const activeWorkspace = useMemo(
    () => workspaces.find((ws) => ws.id === activeWorkspaceId),
    [workspaces, activeWorkspaceId],
  );

  const enterWorkspace = (workspaceId: string) => {
    selectWorkspace(workspaceId);
    setViewMode("workspace");
  };

  const backToOverview = () => setViewMode("overview");

  const handleNewSpace = () => {
    setEditingWorkspace(null);
    setDialogOpen(true);
  };

  const handleEditWorkspace = (workspace: Workspace) => {
    setEditingWorkspace(workspace);
    setDialogOpen(true);
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
          <Typography variant="h6">Spaces</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.25 }}>
            Keep workflows isolated and resume the latest state instantly.
          </Typography>
        </Box>
        <Box flex={1} />
        <Button
          variant="contained"
          startIcon={<AddIcon fontSize="small" />}
          onClick={handleNewSpace}
          size="small"
        >
          New Space
        </Button>
      </Stack>
      <Grid container spacing={1.5} alignContent="flex-start">
        {workspaces.map((workspace) => (
          <Grid item key={workspace.id} xs={12} sm={6} md={4} lg={3}>
            <Card variant={workspace.id === activeWorkspaceId ? "elevation" : "outlined"} sx={{ borderRadius: 2, position: "relative" }}>
              <Tooltip title="Configure space">
                <IconButton
                  size="small"
                  sx={{ position: "absolute", top: 4, right: 4, zIndex: 1 }}
                  onClick={(event) => {
                    event.stopPropagation();
                    handleEditWorkspace(workspace);
                  }}
                >
                  <SettingsIcon fontSize="small" />
                </IconButton>
              </Tooltip>
              <CardActionArea onClick={() => enterWorkspace(workspace.id)} sx={{ height: "100%" }}>
                <CardContent sx={{ p: 2 }}>
                  <Stack spacing={0.75}>
                    <Stack direction="row" spacing={0.75} alignItems="center">
                      <Typography variant="subtitle1" noWrap>
                        {workspace.name}
                      </Typography>
                      {statusChip(workspace)}
                    </Stack>
                    <Typography variant="body2" color="text.secondary" noWrap>
                      {workspace.spaces.length} rooms · {workspace.location}
                    </Typography>
                  </Stack>
                </CardContent>
              </CardActionArea>
            </Card>
          </Grid>
        ))}
        {workspaces.length === 0 && (
          <Grid item xs={12}>
            <Stack spacing={1} alignItems="center" py={4}>
              <Typography variant="subtitle1">No spaces yet</Typography>
              <Typography variant="body2" color="text.secondary" textAlign="center">
                 Create a space to group assets, chats, and tools for a workflow.
               </Typography>
              <Button variant="outlined" startIcon={<AddIcon fontSize="small" />} onClick={handleNewSpace} size="small">
                 Create Space
               </Button>
              </Stack>
            </Grid>
          )}
      </Grid>
      <SpaceConfigDialog
        open={dialogOpen}
        onClose={handleDialogClose}
        initialConfig={
          editingWorkspace
            ? {
                name: editingWorkspace.name,
                description: editingWorkspace.description,
                workDirectories: editingWorkspace.workDirectories,
                assets: editingWorkspace.assets,
                tools: editingWorkspace.tools,
              }
            : createSpaceConfigTemplate(`Workspace ${workspaces.length + 1}`)
        }
        onSave={handleDialogSave}
      />
    </Box>
  );
};

export default SpacesView;
