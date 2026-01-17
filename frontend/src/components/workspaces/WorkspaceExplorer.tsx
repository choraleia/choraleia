import React, { useMemo, useState, useCallback } from "react";
import {
  Box,
  IconButton,
  List,
  ListItem,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  TextField,
  Tooltip,
  Typography,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Divider,
  Checkbox,
} from "@mui/material";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import AddIcon from "@mui/icons-material/Add";
import FolderIcon from "@mui/icons-material/Folder";
import DescriptionIcon from "@mui/icons-material/Description";
import TerminalIcon from "@mui/icons-material/Terminal";
import DnsOutlinedIcon from "@mui/icons-material/DnsOutlined";
import HubOutlinedIcon from "@mui/icons-material/HubOutlined";
import InsertDriveFileOutlinedIcon from "@mui/icons-material/InsertDriveFileOutlined";
import CreateNewFolderOutlinedIcon from "@mui/icons-material/CreateNewFolderOutlined";
import RefreshIcon from "@mui/icons-material/Refresh";
import MoreVertIcon from "@mui/icons-material/MoreVert";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import DriveFileRenameOutlineIcon from "@mui/icons-material/DriveFileRenameOutline";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import VisibilityIcon from "@mui/icons-material/Visibility";
import UnfoldMoreIcon from "@mui/icons-material/UnfoldMore";
import UnfoldLessIcon from "@mui/icons-material/UnfoldLess";
import SortByAlphaIcon from "@mui/icons-material/SortByAlpha";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import ExpandMoreOutlinedIcon from "@mui/icons-material/ExpandMoreOutlined";
import AccessTimeIcon from "@mui/icons-material/AccessTime";
import StorageIcon from "@mui/icons-material/Storage";
import { FileNode, useWorkspaces } from "../../state/workspaces";

type SortBy = "name" | "type" | "size" | "modified";
type SortOrder = "asc" | "desc";

interface FileListOptions {
  showHidden: boolean;
  sortBy: SortBy;
  sortOrder: SortOrder;
  foldersFirst: boolean;
}

interface FileTreeProps {
  nodes: FileNode[];
  openFile: (path: string) => void;
  onContextMenu: (event: React.MouseEvent, node: FileNode) => void;
  expandedFolders: Set<string>;
  toggleFolder: (path: string) => void;
  options: FileListOptions;
  selectedPath: string | null;
  onSelect: (path: string) => void;
  depth?: number;
}

const sortNodes = (nodes: FileNode[], options: FileListOptions): FileNode[] => {
  const sorted = [...nodes].sort((a, b) => {
    // Folders first if enabled
    if (options.foldersFirst) {
      if (a.type === "folder" && b.type !== "folder") return -1;
      if (a.type !== "folder" && b.type === "folder") return 1;
    }

    let comparison = 0;
    switch (options.sortBy) {
      case "name":
        comparison = a.name.localeCompare(b.name);
        break;
      case "type":
        const extA = a.name.includes(".") ? a.name.split(".").pop() || "" : "";
        const extB = b.name.includes(".") ? b.name.split(".").pop() || "" : "";
        comparison = extA.localeCompare(extB) || a.name.localeCompare(b.name);
        break;
      case "size":
      case "modified":
        // For now, fall back to name sorting as we don't have size/modified in FileNode
        comparison = a.name.localeCompare(b.name);
        break;
    }

    return options.sortOrder === "desc" ? -comparison : comparison;
  });

  return sorted;
};

const FileTreeItem: React.FC<{
  node: FileNode;
  depth: number;
  openFile: (path: string) => void;
  onContextMenu: (event: React.MouseEvent, node: FileNode) => void;
  expandedFolders: Set<string>;
  toggleFolder: (path: string) => void;
  options: FileListOptions;
  selectedPath: string | null;
  onSelect: (path: string) => void;
}> = ({ node, depth, openFile, onContextMenu, expandedFolders, toggleFolder, options, selectedPath, onSelect }) => {
  const paddingLeft = depth * 12;
  const isFolder = node.type === "folder";
  const isExpanded = expandedFolders.has(node.path);
  const isSelected = selectedPath === node.path;
  const icon = isFolder ? <FolderIcon fontSize="small" /> : <DescriptionIcon fontSize="small" />;

  // Single click selects the item
  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onSelect(node.path);
  };

  // Click on triangle toggles folder expand/collapse
  const handleTriangleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isFolder) {
      toggleFolder(node.path);
    }
  };

  // Double click: folder toggles expand/collapse, file opens
  const handleDoubleClick = () => {
    if (isFolder) {
      toggleFolder(node.path);
    } else {
      openFile(node.path);
    }
  };

  const sortedChildren = node.children ? sortNodes(node.children, options) : [];

  return (
    <>
      <ListItem disablePadding sx={{ pl: paddingLeft / 8 }}>
        <ListItemButton
          onClick={handleClick}
          onDoubleClick={handleDoubleClick}
          onContextMenu={(e) => onContextMenu(e, node)}
          selected={isSelected}
          dense
          sx={{
            "&.Mui-selected": {
              bgcolor: "action.selected",
            },
            "&.Mui-selected:hover": {
              bgcolor: "action.selected",
            },
          }}
        >
          {/* Triangle for folder expand/collapse */}
          <Box
            onClick={handleTriangleClick}
            sx={{
              width: 16,
              height: 16,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              mr: 0.25,
              visibility: isFolder ? "visible" : "hidden",
              cursor: isFolder ? "pointer" : "default",
            }}
          >
            {isFolder && (
              isExpanded ? (
                <ExpandMoreOutlinedIcon sx={{ fontSize: 16 }} />
              ) : (
                <ChevronRightIcon sx={{ fontSize: 16 }} />
              )
            )}
          </Box>
          <ListItemIcon sx={{ minWidth: 24 }}>{icon}</ListItemIcon>
          <ListItemText primary={node.name} primaryTypographyProps={{ noWrap: true, variant: "body2" }} />
        </ListItemButton>
      </ListItem>
      {isFolder && isExpanded && sortedChildren.length > 0 && (
        sortedChildren.map((child) => (
          <FileTreeItem
            key={child.id}
            node={child}
            depth={depth + 1}
            openFile={openFile}
            onContextMenu={onContextMenu}
            expandedFolders={expandedFolders}
            toggleFolder={toggleFolder}
            options={options}
            selectedPath={selectedPath}
            onSelect={onSelect}
          />
        ))
      )}
    </>
  );
};

const FileTree: React.FC<FileTreeProps> = ({
  nodes,
  openFile,
  onContextMenu,
  expandedFolders,
  toggleFolder,
  options,
  selectedPath,
  onSelect,
}) => {
  const sortedNodes = sortNodes(nodes, options);
  const filteredNodes = options.showHidden
    ? sortedNodes
    : sortedNodes.filter((n) => !n.name.startsWith("."));

  return (
    <>
      {filteredNodes.map((node) => (
        <FileTreeItem
          key={node.id}
          node={node}
          depth={0}
          openFile={openFile}
          onContextMenu={onContextMenu}
          expandedFolders={expandedFolders}
          toggleFolder={toggleFolder}
          options={options}
          selectedPath={selectedPath}
          onSelect={onSelect}
        />
      ))}
    </>
  );
};

interface WorkspaceExplorerProps {
}

const WorkspaceExplorer: React.FC<WorkspaceExplorerProps> = () => {
  const {
    activeWorkspace,
    activeRoom,
    fileTree,
    fileTreeLoading,
    refreshFileTree,
    loadDirectoryChildren,
    openFileFromTree,
    openFileInPaneTree,
    openTerminalTab,
    addFileNode,
    deleteFileNode,
    renameFileNode,
  } = useWorkspaces();

  const [assetsExpanded, setAssetsExpanded] = useState(true);
  const [workspaceExpanded, setWorkspaceExpanded] = useState(true);

  // File list options
  const [fileListOptions, setFileListOptions] = useState<FileListOptions>({
    showHidden: false,
    sortBy: "name",
    sortOrder: "asc",
    foldersFirst: true,
  });

  // Expanded folders
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());

  // Add file/folder menu state
  const [addMenuAnchor, setAddMenuAnchor] = useState<null | HTMLElement>(null);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [createType, setCreateType] = useState<"file" | "folder">("file");
  const [createParentPath, setCreateParentPath] = useState<string | null>(null);
  const [newItemName, setNewItemName] = useState("");

  // File list options menu
  const [optionsMenuAnchor, setOptionsMenuAnchor] = useState<null | HTMLElement>(null);

  // File context menu
  const [contextMenu, setContextMenu] = useState<{ mouseX: number; mouseY: number; node: FileNode } | null>(null);

  // Rename dialog
  const [renameDialogOpen, setRenameDialogOpen] = useState(false);
  const [renameTarget, setRenameTarget] = useState<FileNode | null>(null);
  const [renameValue, setRenameValue] = useState("");

  // Delete confirmation dialog
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<FileNode | null>(null);

  // Selected file/folder path
  const [selectedFilePath, setSelectedFilePath] = useState<string | null>(null);

  const toggleFolder = useCallback((path: string) => {
    setExpandedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
        // Check if this folder needs lazy loading (has empty children array)
        const findNode = (nodes: FileNode[]): FileNode | undefined => {
          for (const node of nodes) {
            if (node.path === path) return node;
            if (node.children) {
              const found = findNode(node.children);
              if (found) return found;
            }
          }
          return undefined;
        };
        const node = findNode(fileTree);
        if (node && node.type === "folder" && node.children && node.children.length === 0) {
          // Lazy load children
          loadDirectoryChildren(path);
        }
      }
      return next;
    });
  }, [fileTree, loadDirectoryChildren]);

  const expandAllFolders = useCallback(() => {
    const allFolderPaths = new Set<string>();
    const collectFolders = (nodes: FileNode[]) => {
      nodes.forEach((node) => {
        if (node.type === "folder") {
          allFolderPaths.add(node.path);
          if (node.children) collectFolders(node.children);
        }
      });
    };
    collectFolders(fileTree);
    setExpandedFolders(allFolderPaths);
  }, [fileTree]);

  const collapseAllFolders = useCallback(() => {
    setExpandedFolders(new Set());
  }, []);

  // Add menu handlers
  const handleAddClick = (event: React.MouseEvent<HTMLElement>) => {
    event.stopPropagation();
    setCreateParentPath(null);
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
      addFileNode(createParentPath, createType, newItemName.trim());
      setCreateDialogOpen(false);
      setNewItemName("");
      setCreateParentPath(null);
    }
  };

  // Options menu handlers
  const handleOptionsClick = (event: React.MouseEvent<HTMLElement>) => {
    event.stopPropagation();
    setOptionsMenuAnchor(event.currentTarget);
  };

  const handleOptionsMenuClose = () => {
    setOptionsMenuAnchor(null);
  };

  const handleSortByChange = (sortBy: SortBy) => {
    setFileListOptions((prev) => ({
      ...prev,
      sortBy,
      sortOrder: prev.sortBy === sortBy ? (prev.sortOrder === "asc" ? "desc" : "asc") : "asc",
    }));
  };

  // File context menu handlers
  const handleFileContextMenu = useCallback((event: React.MouseEvent, node: FileNode) => {
    event.preventDefault();
    event.stopPropagation();
    setContextMenu({ mouseX: event.clientX, mouseY: event.clientY, node });
  }, []);

  const handleContextMenuClose = () => {
    setContextMenu(null);
  };

  const handleCopyPath = () => {
    if (contextMenu) {
      navigator.clipboard.writeText(contextMenu.node.path);
    }
    handleContextMenuClose();
  };

  const handleOpenRenameDialog = () => {
    if (contextMenu) {
      setRenameTarget(contextMenu.node);
      setRenameValue(contextMenu.node.name);
      setRenameDialogOpen(true);
    }
    handleContextMenuClose();
  };

  const handleRenameConfirm = () => {
    if (renameTarget && renameValue.trim() && renameValue !== renameTarget.name) {
      renameFileNode(renameTarget.path, renameValue.trim());
    }
    setRenameDialogOpen(false);
    setRenameTarget(null);
    setRenameValue("");
  };

  const handleOpenDeleteDialog = () => {
    if (contextMenu) {
      setDeleteTarget(contextMenu.node);
      setDeleteDialogOpen(true);
    }
    handleContextMenuClose();
  };

  const handleDeleteConfirm = () => {
    if (deleteTarget) {
      deleteFileNode(deleteTarget.path);
    }
    setDeleteDialogOpen(false);
    setDeleteTarget(null);
  };

  const handleNewFileInFolder = () => {
    if (contextMenu && contextMenu.node.type === "folder") {
      setCreateParentPath(contextMenu.node.path);
      setCreateType("file");
      setNewItemName("");
      setCreateDialogOpen(true);
    }
    handleContextMenuClose();
  };

  const handleNewFolderInFolder = () => {
    if (contextMenu && contextMenu.node.type === "folder") {
      setCreateParentPath(contextMenu.node.path);
      setCreateType("folder");
      setNewItemName("");
      setCreateDialogOpen(true);
    }
    handleContextMenuClose();
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

      // Map workspace asset references to display items
      const workspaceAssets = (activeWorkspace.assets?.assets || []).map((assetRef) => {
        // Determine icon based on asset type
        let icon;
        switch (assetRef.assetType) {
          case "ssh":
            icon = <DnsOutlinedIcon fontSize="small" />;
            break;
          case "docker_host":
            icon = <StorageIcon fontSize="small" />;
            break;
          case "k8s":
            icon = <HubOutlinedIcon fontSize="small" />;
            break;
          case "local":
            icon = <TerminalIcon fontSize="small" />;
            break;
          default:
            icon = <DnsOutlinedIcon fontSize="small" />;
        }

        return {
          id: assetRef.id,
          name: assetRef.assetName,
          subtitle: assetRef.assetType,
          icon,
          aiHint: assetRef.aiHint,
        };
      });

      // Legacy support: also include old hosts and k8s configs if present
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
      return [...workspaceAssets, ...hostAssets, ...k8sAssets];
    },
    [activeWorkspace],
  );

  if (!activeRoom) return null;

  // Calculate heights based on which accordions are expanded
  const getWorkspaceHeight = () => {
    if (!workspaceExpanded) return "auto";
    if (!assetsExpanded) return "100%";
    return "50%";
  };
  const getAssetsHeight = () => {
    if (!assetsExpanded) return "auto";
    if (!workspaceExpanded) return "100%";
    return "50%";
  };

  return (
    <Box
      sx={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        overflow: "hidden",
      }}
    >
      {/* Workspace Section */}
      <Box
        sx={{
          height: getWorkspaceHeight(),
          minHeight: workspaceExpanded ? 100 : "auto",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          borderBottom: "1px solid",
          borderColor: "divider",
        }}
      >
        <Box
          onClick={() => setWorkspaceExpanded(!workspaceExpanded)}
          sx={{
            display: "flex",
            alignItems: "center",
            px: 2,
            py: 0.5,
            minHeight: 36,
            cursor: "pointer",
            "&:hover": { bgcolor: "action.hover" },
          }}
        >
          <ExpandMoreIcon
            fontSize="small"
            sx={{
              transform: workspaceExpanded ? "rotate(0deg)" : "rotate(-90deg)",
              transition: "transform 0.2s",
              mr: 1,
            }}
          />
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
          <Tooltip title="File list options">
            <IconButton size="small" sx={{ p: 0.5 }} onClick={handleOptionsClick}>
              <MoreVertIcon fontSize="inherit" />
            </IconButton>
          </Tooltip>
        </Box>
        {workspaceExpanded && (
          <Box
            sx={{
              flex: 1,
              overflow: "auto",
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
                <FileTree
                  nodes={fileTree}
                  openFile={openFileInPaneTree}
                  onContextMenu={handleFileContextMenu}
                  expandedFolders={expandedFolders}
                  toggleFolder={toggleFolder}
                  options={fileListOptions}
                  selectedPath={selectedFilePath}
                  onSelect={setSelectedFilePath}
                />
              ) : (
                <ListItem>
                  <ListItemText
                    primary="No files"
                    primaryTypographyProps={{ variant: "body2", color: "text.secondary" }}
                  />
                </ListItem>
              )}
            </List>
          </Box>
        )}
      </Box>

      {/* Assets Section */}
      <Box
        sx={{
          height: getAssetsHeight(),
          minHeight: assetsExpanded ? 100 : "auto",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        <Box
          onClick={() => setAssetsExpanded(!assetsExpanded)}
          sx={{
            display: "flex",
            alignItems: "center",
            px: 2,
            py: 0.5,
            minHeight: 36,
            cursor: "pointer",
            "&:hover": { bgcolor: "action.hover" },
          }}
        >
          <ExpandMoreIcon
            fontSize="small"
            sx={{
              transform: assetsExpanded ? "rotate(0deg)" : "rotate(-90deg)",
              transition: "transform 0.2s",
              mr: 1,
            }}
          />
          <Typography variant="subtitle2">Assets</Typography>
          <Typography variant="caption" color="text.secondary" sx={{ ml: 1 }}>
            {assetItems.length}
          </Typography>
        </Box>
        {assetsExpanded && (
          <Box
            sx={{
              flex: 1,
              overflow: "auto",
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
                  "& .MuiListItem-root": { my: 0 },
                  "& .MuiListItemButton-root": { py: 0.25 },
                }}
              >
                {assetItems.map((asset) => (
                  <ListItem disablePadding key={asset.id}>
                    <ListItemButton dense>
                      <ListItemIcon sx={{ minWidth: 28 }}>{asset.icon}</ListItemIcon>
                      <ListItemText
                        primary={asset.name || "(unnamed)"}
                        secondary={asset.subtitle}
                        primaryTypographyProps={{ noWrap: true, variant: "body2" }}
                        secondaryTypographyProps={{ noWrap: true, variant: "caption" }}
                        sx={{ overflow: "hidden" }}
                      />
                    </ListItemButton>
                  </ListItem>
                ))}
              </List>
            )}
          </Box>
        )}
      </Box>

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

      {/* File list options menu */}
      <Menu
        anchorEl={optionsMenuAnchor}
        open={Boolean(optionsMenuAnchor)}
        onClose={handleOptionsMenuClose}
        anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
        transformOrigin={{ vertical: "top", horizontal: "right" }}
      >
        <MenuItem onClick={() => handleSortByChange("name")}>
          <ListItemIcon>
            <SortByAlphaIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText primaryTypographyProps={{ variant: "body2" }}>
            Sort by Name {fileListOptions.sortBy === "name" && (fileListOptions.sortOrder === "asc" ? "↑" : "↓")}
          </ListItemText>
        </MenuItem>
        <MenuItem onClick={() => handleSortByChange("type")}>
          <ListItemIcon>
            <DescriptionIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText primaryTypographyProps={{ variant: "body2" }}>
            Sort by Type {fileListOptions.sortBy === "type" && (fileListOptions.sortOrder === "asc" ? "↑" : "↓")}
          </ListItemText>
        </MenuItem>
        <Divider />
        <MenuItem onClick={() => setFileListOptions((prev) => ({ ...prev, foldersFirst: !prev.foldersFirst }))}>
          <ListItemIcon>
            <FolderIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText primaryTypographyProps={{ variant: "body2" }}>Folders First</ListItemText>
          <Checkbox size="small" checked={fileListOptions.foldersFirst} sx={{ p: 0, ml: 1 }} />
        </MenuItem>
        <MenuItem onClick={() => setFileListOptions((prev) => ({ ...prev, showHidden: !prev.showHidden }))}>
          <ListItemIcon>
            <VisibilityIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText primaryTypographyProps={{ variant: "body2" }}>Show Hidden Files</ListItemText>
          <Checkbox size="small" checked={fileListOptions.showHidden} sx={{ p: 0, ml: 1 }} />
        </MenuItem>
        <Divider />
        <MenuItem onClick={expandAllFolders}>
          <ListItemIcon>
            <UnfoldMoreIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText primaryTypographyProps={{ variant: "body2" }}>Expand All</ListItemText>
        </MenuItem>
        <MenuItem onClick={collapseAllFolders}>
          <ListItemIcon>
            <UnfoldLessIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText primaryTypographyProps={{ variant: "body2" }}>Collapse All</ListItemText>
        </MenuItem>
      </Menu>

      {/* File context menu */}
      <Menu
        open={contextMenu !== null}
        onClose={handleContextMenuClose}
        anchorReference="anchorPosition"
        anchorPosition={
          contextMenu !== null
            ? { top: contextMenu.mouseY, left: contextMenu.mouseX }
            : undefined
        }
      >
        {contextMenu?.node.type === "folder" && [
          <MenuItem key="new-file" onClick={handleNewFileInFolder}>
            <ListItemIcon>
              <InsertDriveFileOutlinedIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText primaryTypographyProps={{ variant: "body2" }}>New File</ListItemText>
          </MenuItem>,
          <MenuItem key="new-folder" onClick={handleNewFolderInFolder}>
            <ListItemIcon>
              <CreateNewFolderOutlinedIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText primaryTypographyProps={{ variant: "body2" }}>New Folder</ListItemText>
          </MenuItem>,
          <Divider key="divider-1" />,
        ]}
        <MenuItem onClick={handleCopyPath}>
          <ListItemIcon>
            <ContentCopyIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText primaryTypographyProps={{ variant: "body2" }}>Copy Path</ListItemText>
        </MenuItem>
        <MenuItem onClick={handleOpenRenameDialog}>
          <ListItemIcon>
            <DriveFileRenameOutlineIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText primaryTypographyProps={{ variant: "body2" }}>Rename</ListItemText>
        </MenuItem>
        <Divider />
        <MenuItem onClick={handleOpenDeleteDialog}>
          <ListItemIcon>
            <DeleteOutlineIcon fontSize="small" color="error" />
          </ListItemIcon>
          <ListItemText primaryTypographyProps={{ variant: "body2", color: "error" }}>Delete</ListItemText>
        </MenuItem>
      </Menu>

      {/* Create file/folder dialog */}
      <Dialog open={createDialogOpen} onClose={() => setCreateDialogOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>
          {createType === "file" ? "New File" : "New Folder"}
          {createParentPath && (
            <Typography variant="caption" display="block" color="text.secondary">
              in {createParentPath}
            </Typography>
          )}
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

      {/* Rename dialog */}
      <Dialog open={renameDialogOpen} onClose={() => setRenameDialogOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>Rename</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            fullWidth
            size="small"
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                handleRenameConfirm();
              }
            }}
            sx={{ mt: 1 }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRenameDialogOpen(false)} size="small">Cancel</Button>
          <Button
            onClick={handleRenameConfirm}
            variant="contained"
            size="small"
            disabled={!renameValue.trim() || renameValue === renameTarget?.name}
          >
            Rename
          </Button>
        </DialogActions>
      </Dialog>

      {/* Delete confirmation dialog */}
      <Dialog open={deleteDialogOpen} onClose={() => setDeleteDialogOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>Delete {deleteTarget?.type === "folder" ? "Folder" : "File"}</DialogTitle>
        <DialogContent>
          <Typography variant="body2">
            Are you sure you want to delete "{deleteTarget?.name}"?
            {deleteTarget?.type === "folder" && " This will delete all contents inside."}
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteDialogOpen(false)} size="small">Cancel</Button>
          <Button onClick={handleDeleteConfirm} variant="contained" color="error" size="small">
            Delete
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default WorkspaceExplorer;
