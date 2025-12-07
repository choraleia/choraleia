import React, { useState } from "react";
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Box,
  Button,
  IconButton,
  List,
  ListItem,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  MenuItem,
  Select,
  Stack,
  Tooltip,
  Typography,
} from "@mui/material";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import PlaylistAddIcon from "@mui/icons-material/PlaylistAdd";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import SettingsOutlinedIcon from "@mui/icons-material/SettingsOutlined";
import FolderIcon from "@mui/icons-material/Folder";
import DescriptionIcon from "@mui/icons-material/Description";
import { FileNode, useWorkspaces } from "../../state/workspaces";

const renderTree = (
  nodes: FileNode[],
  openFile: (path: string) => void,
  depth = 0,
): React.ReactNode =>
  nodes.map((node) => {
    const paddingLeft = depth * 12;
    const icon = node.type === "folder" ? <FolderIcon /> : <DescriptionIcon />;
    if (node.children && node.children.length > 0) {
      return (
        <React.Fragment key={node.id}>
          <ListItem disablePadding sx={{ pl: paddingLeft / 8 }}>
            <ListItemButton
              onClick={() =>
                node.type === "file" ? openFile(node.path) : undefined
              }
              dense
            >
              <ListItemIcon sx={{ minWidth: 32 }}>{icon}</ListItemIcon>
              <ListItemText primary={node.name} primaryTypographyProps={{ noWrap: true }} />
            </ListItemButton>
          </ListItem>
          {renderTree(node.children, openFile, depth + 1)}
        </React.Fragment>
      );
    }
    return (
      <ListItem disablePadding key={node.id} sx={{ pl: paddingLeft / 8 }}>
        <ListItemButton onClick={() => openFile(node.path)} dense>
          <ListItemIcon sx={{ minWidth: 32 }}>{icon}</ListItemIcon>
          <ListItemText primary={node.name} primaryTypographyProps={{ noWrap: true }} />
        </ListItemButton>
      </ListItem>
    );
  });

interface RightInspectorProps {
  onBackToOverview?: () => void;
}

const RightInspector: React.FC<RightInspectorProps> = ({ onBackToOverview }) => {
  const {
    workspaces,
    activeWorkspaceId,
    selectWorkspace,
    activeSpace,
    openFileFromTree,
  } = useWorkspaces();
  const [workspaceExpanded, setWorkspaceExpanded] = useState(true);
  const toggleWorkspace = (_event: React.SyntheticEvent, isExpanded: boolean) => setWorkspaceExpanded(isExpanded);
  if (!activeSpace) return null;
  return (
    <Box
      width={300}
      borderRight={(theme) => `1px solid ${theme.palette.divider}`}
      display="flex"
      flexDirection="column"
      sx={{ bgcolor: "background.paper" }}
    >
      <Box px={1.5} py={1.25} borderBottom={(theme) => `1px solid ${theme.palette.divider}`}>
        <Stack direction="row" spacing={0.75} alignItems="center">
          <Select
            size="small"
            fullWidth
            value={activeWorkspaceId || ""}
            onChange={(event) => selectWorkspace(event.target.value as string)}
          >
            {workspaces.map((workspace) => (
              <MenuItem key={workspace.id} value={workspace.id}>
                {workspace.name}
              </MenuItem>
            ))}
          </Select>
          {onBackToOverview && (
            <IconButton size="small" onClick={onBackToOverview} sx={{ p: 0.5 }}>
              <ArrowBackIcon fontSize="small" />
            </IconButton>
          )}
          <IconButton size="small" sx={{ p: 0.5 }}>
            <SettingsOutlinedIcon fontSize="small" />
          </IconButton>
        </Stack>
      </Box>
      <Accordion
        disableGutters
        expanded={workspaceExpanded}
        onChange={toggleWorkspace}
        square
        sx={{
          flex: workspaceExpanded ? "1 1 0%" : "0 auto",
          minHeight: 0,
          display: "flex",
          flexDirection: "column",
          transition: "flex 0.2s ease",
        }}
      >
        <AccordionSummary
          expandIcon={<ExpandMoreIcon fontSize="small" />}
          sx={{ minHeight: 36, "& .MuiAccordionSummary-content": { my: 0 } }}
        >
          <Typography variant="subtitle2">Workspace</Typography>
          <Box flex={1} />
          <Tooltip title="Add file or folder">
            <IconButton size="small" sx={{ p: 0.5 }}>
              <PlaylistAddIcon fontSize="inherit" />
            </IconButton>
          </Tooltip>
        </AccordionSummary>
        <AccordionDetails
          sx={{
            flex: workspaceExpanded ? 1 : 0,
            minHeight: 0,
            overflow: workspaceExpanded ? "auto" : "hidden",
            p: 0,
          }}
        >
          <List
            dense
            disablePadding
            sx={{
              "& .MuiListItemIcon-root": { minWidth: 24 },
              "& .MuiListItem-root": { my: 0 },
              "& .MuiListItemButton-root": { py: 0.25 },
            }}
          >
            {renderTree(activeSpace.fileTree, openFileFromTree)}
          </List>
        </AccordionDetails>
      </Accordion>
    </Box>
  );
};

export default RightInspector;
