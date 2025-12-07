import React from "react";
import {
  Box,
  Button,
  Chip,
  IconButton,
  Tooltip,
  Typography,
} from "@mui/material";
import SpaceDashboardIcon from "@mui/icons-material/SpaceDashboard";
import AddIcon from "@mui/icons-material/Add";
import LayersIcon from "@mui/icons-material/Layers";
import LocationOnIcon from "@mui/icons-material/LocationOn";
import BoltIcon from "@mui/icons-material/Bolt";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import { useWorkspaces } from "../../state/workspaces";

interface SpaceTopBarProps {
  onOpenManager: () => void;
  onBack?: () => void;
}

const SpaceTopBar: React.FC<SpaceTopBarProps> = ({ onOpenManager, onBack }) => {
  const { activeWorkspace, selectSpace, createSpace } = useWorkspaces();

  if (!activeWorkspace) return null;
  const { spaces, activeSpaceId, status, location, name } = activeWorkspace;

  return (
    <Box
      px={2}
      py={1.5}
      display="flex"
      flexDirection="column"
      gap={1}
      sx={(theme) => ({ borderBottom: `1px solid ${theme.palette.divider}` })}
    >
      <Box display="flex" alignItems="center" gap={1}>
        {onBack && (
          <Button
            size="small"
            startIcon={<ArrowBackIcon fontSize="small" />}
            onClick={onBack}
            sx={{ mr: 1 }}
          >
            All Spaces
          </Button>
        )}
        <LayersIcon color="primary" />
        <Typography variant="h6" component="h1">
          {name}
        </Typography>
        <Chip
          size="small"
          icon={<BoltIcon fontSize="small" />}
          label={status}
          color={status === "running" ? "success" : "default"}
        />
        <Chip
          size="small"
          icon={<LocationOnIcon fontSize="small" />}
          label={location}
          variant="outlined"
        />
        <Box flex={1} />
        <Tooltip title="Manage Spaces">
          <IconButton onClick={onOpenManager}>
            <SpaceDashboardIcon />
          </IconButton>
        </Tooltip>
      </Box>
      <Box display="flex" alignItems="center" gap={1} flexWrap="wrap">
        {spaces.map((space) => {
          const isActive = space.id === activeSpaceId;
          return (
            <Chip
              key={space.id}
              label={space.name}
              color={isActive ? "primary" : "default"}
              onClick={() => selectSpace(space.id)}
              sx={{
                bgcolor: isActive ? undefined : "transparent",
                borderRadius: 2,
                cursor: "pointer",
              }}
            />
          );
        })}
        <Button
          size="small"
          startIcon={<AddIcon fontSize="small" />}
          onClick={createSpace}
        >
          New Space
        </Button>
      </Box>
    </Box>
  );
};

export default SpaceTopBar;
