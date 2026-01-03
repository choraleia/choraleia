import React, { useMemo, useState } from "react";
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Box,
  IconButton,
  List,
  ListItem,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  Select,
  Stack,
  TextField,
  Tooltip,
  Typography,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
} from "@mui/material";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import AddIcon from "@mui/icons-material/Add";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import SettingsOutlinedIcon from "@mui/icons-material/SettingsOutlined";
import FolderIcon from "@mui/icons-material/Folder";
import DescriptionIcon from "@mui/icons-material/Description";
import TerminalIcon from "@mui/icons-material/Terminal";
import DnsOutlinedIcon from "@mui/icons-material/DnsOutlined";
import HubOutlinedIcon from "@mui/icons-material/HubOutlined";
import InsertDriveFileOutlinedIcon from "@mui/icons-material/InsertDriveFileOutlined";
import CreateNewFolderOutlinedIcon from "@mui/icons-material/CreateNewFolderOutlined";
import RefreshIcon from "@mui/icons-material/Refresh";
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
              onDoubleClick={() =>
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
        <ListItemButton onDoubleClick={() => openFile(node.path)} dense>
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
    activeWorkspace,
    selectWorkspace,
    activeRoom,
    fileTree,
    fileTreeLoading,
    refreshFileTree,
    openFileFromTree,
    openTerminalTab,
    addFileNode,
  } = useWorkspaces();
  const [assetsExpanded, setAssetsExpanded] = useState(true);
  const [workspaceExpanded, setWorkspaceExpanded] = useState(true);

  // Add file/folder menu state
  const [addMenuAnchor, setAddMenuAnchor] = useState<null | HTMLElement>(null);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [createType, setCreateType] = useState<"file" | "folder">("file");
  const [newItemName, setNewItemName] = useState("");

  const toggleWorkspace = (_event: React.SyntheticEvent, isExpanded: boolean) => setWorkspaceExpanded(isExpanded);
  const toggleAssets = (_event: React.SyntheticEvent, isExpanded: boolean) => setAssetsExpanded(isExpanded);

  const handleAddClick = (event: React.MouseEvent<HTMLElement>) => {
    event.stopPropagation();
    setAddMenuAnchor(event.currentTarget);
  };

  const handleAddMenuClose = () => {
    setAddMenuAnchor(null);
  };

  const handleCreateItem = (type: "file" | "folder") => {
    setCreateType(type);
    setNewItemName("");
    setCreateDialogOpen(true);
    handleAddMenuClose();
  };

  const handleCreateConfirm = () => {
    if (newItemName.trim()) {
      addFileNode(null, createType, newItemName.trim());
      setCreateDialogOpen(false);
      setNewItemName("");
    }
  };

  const handleTerminalClick = (event: React.MouseEvent) => {
    event.stopPropagation();
    openTerminalTab();
  };

  const handleRefreshClick = (event: React.MouseEvent) => {
    event.stopPropagation();
    refreshFileTree();
  };

  const assetItems = useMemo(
    () => {
      if (!activeWorkspace) return [];
      const hostAssets = (activeWorkspace.assets?.hosts || []).map((host) => ({
        id: host.id,
        name: host.name,
        subtitle: host.address,
        icon: <DnsOutlinedIcon fontSize="small" />,
      }));
      const k8sAssets = (activeWorkspace.assets?.k8s || []).map((cluster) => ({
        id: cluster.id,
        name: cluster.name,
        subtitle: cluster.namespace,
        icon: <HubOutlinedIcon fontSize="small" />,
      }));
      return [...hostAssets, ...k8sAssets];
    },
    [activeWorkspace],
  );
  if (!activeRoom) return null;
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
            <IconButton size="small" sx={{ p: 0.5 }} onClick={handleAddClick}>
              <AddIcon fontSize="inherit" />
            </IconButton>
          </Tooltip>
          <Tooltip title="Refresh">
            <IconButton size="small" sx={{ p: 0.5 }} onClick={handleRefreshClick}>
              <RefreshIcon fontSize="inherit" />
            </IconButton>
          </Tooltip>
          <Tooltip title="Open terminal">
            <IconButton size="small" sx={{ p: 0.5 }} onClick={handleTerminalClick}>
              <TerminalIcon fontSize="inherit" />
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
            {fileTreeLoading ? (
              <ListItem>
                <ListItemText
                  primary="Loading files..."
                  primaryTypographyProps={{ variant: "body2", color: "text.secondary" }}
                />
              </ListItem>
            ) : fileTree.length > 0 ? (
              renderTree(fileTree, openFileFromTree)
            ) : (
              <ListItem>
                <ListItemText
                  primary="No files"
                  primaryTypographyProps={{ variant: "body2", color: "text.secondary" }}
                />
              </ListItem>
            )}
          </List>
        </AccordionDetails>
      </Accordion>
      <Accordion
        disableGutters
        expanded={assetsExpanded}
        onChange={toggleAssets}
        square
        sx={{
          flex: assetsExpanded ? "1 1 0%" : "0 auto",
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
          <Typography variant="subtitle2">Assets</Typography>
          <Typography variant="caption" color="text.secondary" sx={{ ml: 1 }}>
            {assetItems.length}
          </Typography>
        </AccordionSummary>
        <AccordionDetails
          sx={{
            flex: assetsExpanded ? 1 : 0,
            minHeight: 0,
            overflow: assetsExpanded ? "auto" : "hidden",
            p: 0,
          }}
        >
          {assetItems.length === 0 ? (
            <Box px={1.5} py={1}>
              <Typography variant="body2" color="text.secondary">
                No assets configured for this workspace.
              </Typography>
            </Box>
          ) : (
            <List
              dense
              disablePadding
              sx={{
                "& .MuiListItemIcon-root": { minWidth: 24 },
                "& .MuiListItem-root": { my: 0 },
                "& .MuiListItemButton-root": { py: 0.25 },
              }}
            >
              {assetItems.map((asset) => (
                <ListItem disablePadding key={asset.id}>
                  <ListItemButton dense>
                    <ListItemIcon sx={{ minWidth: 28 }}>{asset.icon}</ListItemIcon>
                    <ListItemText
                      primary={asset.name}
                      secondary={asset.subtitle}
                      primaryTypographyProps={{ noWrap: true }}
                      secondaryTypographyProps={{ noWrap: true }}
                    />
                  </ListItemButton>
                </ListItem>
              ))}
            </List>
          )}
        </AccordionDetails>
      </Accordion>

      {/* Add file/folder menu */}
      <Menu
        anchorEl={addMenuAnchor}
        open={Boolean(addMenuAnchor)}
        onClose={handleAddMenuClose}
        anchorOrigin={{ vertical: "bottom", horizontal: "left" }}
        transformOrigin={{ vertical: "top", horizontal: "left" }}
      >
        <MenuItem onClick={() => handleCreateItem("file")}>
          <ListItemIcon>
            <InsertDriveFileOutlinedIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText primaryTypographyProps={{ variant: "body2" }}>New File</ListItemText>
        </MenuItem>
        <MenuItem onClick={() => handleCreateItem("folder")}>
          <ListItemIcon>
            <CreateNewFolderOutlinedIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText primaryTypographyProps={{ variant: "body2" }}>New Folder</ListItemText>
        </MenuItem>
      </Menu>

      {/* Create file/folder dialog */}
      <Dialog open={createDialogOpen} onClose={() => setCreateDialogOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>
          {createType === "file" ? "New File" : "New Folder"}
        </DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            fullWidth
            size="small"
            placeholder={createType === "file" ? "filename.txt" : "folder-name"}
            value={newItemName}
            onChange={(e) => setNewItemName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                handleCreateConfirm();
              }
            }}
            sx={{ mt: 1 }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCreateDialogOpen(false)} size="small">Cancel</Button>
          <Button onClick={handleCreateConfirm} variant="contained" size="small" disabled={!newItemName.trim()}>
            Create
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default RightInspector;
