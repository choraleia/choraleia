import React from "react";
import { Box, Button, IconButton, Tooltip, Typography } from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import PauseIcon from "@mui/icons-material/Pause";
import LaptopIcon from "@mui/icons-material/Laptop";
import CloudIcon from "@mui/icons-material/Cloud";
import SyncIcon from "@mui/icons-material/Sync";
import MoreVertIcon from "@mui/icons-material/MoreVert";
import { Workspace, useWorkspaces } from "../../state/workspaces";

const statusIcon = (workspace: Workspace) => {
  switch (workspace.location) {
    case "Local":
      return <LaptopIcon fontSize="small" />;
    case "Remote":
    default:
      return <CloudIcon fontSize="small" />;
  }
};

const WorkspaceRail: React.FC = () => {
  const {
    workspaces,
    activeWorkspaceId,
    selectWorkspace,
    createWorkspace,
  } = useWorkspaces();

  return (
    <Box
      width={72}
      display="flex"
      flexDirection="column"
      alignItems="center"
      py={1}
      gap={1}
      sx={(theme) => ({
        bgcolor: theme.palette.background.paper,
        borderRight: `1px solid ${theme.palette.divider}`,
      })}
    >
      <Tooltip title="Add Workspace">
        <IconButton color="primary" onClick={createWorkspace}>
          <AddIcon />
        </IconButton>
      </Tooltip>
      <Box display="flex" flexDirection="column" gap={1} flex={1} width="100%">
        {workspaces.map((workspace) => {
          const isActive = workspace.id === activeWorkspaceId;
          return (
            <Button
              key={workspace.id}
              onClick={() => selectWorkspace(workspace.id)}
              sx={(theme) => ({
                minWidth: 0,
                flexDirection: "column",
                gap: 0.5,
                py: 1,
                color: isActive
                  ? theme.palette.primary.main
                  : theme.palette.text.secondary,
                bgcolor: isActive ? theme.palette.action.selected : "transparent",
                textTransform: "none",
                borderRadius: 2,
                mx: 1,
              })}
            >
              <Box display="flex" flexDirection="column" alignItems="center" gap={0.5}>
                <Box
                  width={26}
                  height={26}
                  borderRadius={1.5}
                  display="flex"
                  alignItems="center"
                  justifyContent="center"
                  sx={{ bgcolor: workspace.color, color: "white", fontWeight: 600 }}
                >
                  {workspace.name
                    .split(" ")
                    .map((part) => part[0])
                    .join("")
                    .slice(0, 2)
                    .toUpperCase()}
                </Box>
                {statusIcon(workspace)}
                <Typography variant="caption" noWrap>
                  {workspace.name}
                </Typography>
                <Tooltip title={workspace.status} placement="right">
                  <Box component="span" display="flex" alignItems="center" gap={0.5}>
                    {workspace.status === "running" ? (
                      <PlayArrowIcon fontSize="inherit" />
                    ) : (
                      <PauseIcon fontSize="inherit" />
                    )}
                    <SyncIcon fontSize="inherit" />
                  </Box>
                </Tooltip>
              </Box>
            </Button>
          );
        })}
      </Box>
      <IconButton>
        <MoreVertIcon fontSize="small" />
      </IconButton>
    </Box>
  );
};

export default WorkspaceRail;

