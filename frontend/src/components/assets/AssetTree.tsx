import React, {
  useState,
  useEffect,
  useImperativeHandle,
  useRef,
  useMemo,
  useCallback,
} from "react";
// Debug flag: drag log (enable only during development when needed).
const DEBUG_DND = false;
import {
  Box,
  IconButton,
  Menu as MuiMenu,
  MenuItem,
  Button,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Typography,
  Select,
  FormControl,
  InputLabel,
  CircularProgress,
} from "@mui/material";
import { SimpleTreeView, TreeItem as XTreeItem } from "@mui/x-tree-view";
import AddIcon from "@mui/icons-material/Add";
import RefreshIcon from "@mui/icons-material/Refresh";
import FolderIcon from "@mui/icons-material/Folder";
import ComputerIcon from "@mui/icons-material/Computer";
import LanIcon from "@mui/icons-material/Lan";
import ViewInArIcon from "@mui/icons-material/ViewInAr";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import StopIcon from "@mui/icons-material/Stop";
import DriveFileRenameOutlineIcon from "@mui/icons-material/DriveFileRenameOutline";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import DeleteIcon from "@mui/icons-material/Delete";
import SearchIcon from "@mui/icons-material/Search";
import ClearIcon from "@mui/icons-material/Clear";
import Popover from "@mui/material/Popover";
import AddHostDialog from "./AddHostDialog.tsx";
import { getApiUrl } from "../../api/base";


// Remove old API_BASE constant and use getApiUrl("/api/...") at call sites.

// Unified API base URL
// (Avoid getApiUrl("") + "/api/..." concatenation; build endpoints with getApiUrl("/api/...") instead.)

// Asset type interface
export interface Asset {
  id: string;
  name: string;
  type: "local" | "ssh" | "folder" | "docker_host";
  description: string;
  config: Record<string, any>;
  tags: string[];
  parent_id: string | null;
  prev_id?: string | null;
  next_id?: string | null;
  created_at: string;
  updated_at: string;
}

// Docker container info for dynamic children
export interface ContainerInfo {
  id: string;
  name: string;
  image: string;
  state: string;
  status: string;
  ports: string;
  created: string;
}

interface ApiResponse<T> {
  code: number;
  message: string;
  data?: T;
}
interface AssetListResponse {
  assets: Asset[];
  total: number;
}
export interface HostNode {
  title: string;
  key: string;
  children?: HostNode[];
  isLeaf?: boolean;
  ip?: string;
  port?: number;
  asset?: Asset;
  icon?: React.ReactNode;
  // Docker host dynamic children
  isDynamic?: boolean;
  dynamicLoaded?: boolean;
  containerInfo?: ContainerInfo;
  dockerHostAssetId?: string; // For container nodes, reference to parent docker host
}
export interface AssetTreeHandle {
  refresh: () => void;
}
interface AssetsTreeProps {}

// Move request structure
interface MoveRequest {
  new_parent_id: string | null;
  target_sibling_id?: string | null;
  position: "before" | "after" | "append";
}

// Extract host info early to avoid TDZ issues inside convertAssetsToTreeData
function extractHostInfo(asset: Asset): { host: string; port: number } | null {
  if (asset.type === "ssh")
    return {
      host: asset.config.host || "localhost",
      port: asset.config.port || 22,
    };
  if (asset.type === "local") return { host: "localhost", port: 0 };
  if (asset.type === "docker_host") return { host: "docker", port: 0 };
  return null;
}

const AssetTree = React.forwardRef<AssetTreeHandle, AssetsTreeProps>(
  ({}, ref) => {
    // State
    const [allAssets, setAllAssets] = useState<Asset[]>([]); // full assets
    const [assets, setAssets] = useState<Asset[]>([]); // visible assets (search + filter)
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string>("");
    const [search, setSearch] = useState("");
    const [typeFilter, setTypeFilter] = useState<string>("all");
    // Replace original showSearch flag with Popover anchor
    const [searchAnchorEl, setSearchAnchorEl] = useState<HTMLElement | null>(
      null,
    );

    // ====== Resizable width ======
    const [width, setWidth] = useState<number>(() => {
      const saved = Number(localStorage.getItem("assetTreeWidth"));
      return !isNaN(saved) && saved >= 160 ? saved : 200; // default 200, min 160
    });
    const resizingRef = useRef<boolean>(false);
    const startXRef = useRef<number>(0);
    const startWidthRef = useRef<number>(0);
    const finalWidthRef = useRef<number>(width);
    useEffect(() => {
      finalWidthRef.current = width;
    }, [width]);
    const handleResizeMouseDown = (e: React.MouseEvent) => {
      if (e.button !== 0) return; // left button only
      resizingRef.current = true;
      startXRef.current = e.clientX;
      startWidthRef.current = finalWidthRef.current;
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
      const onMove = (ev: MouseEvent) => {
        if (!resizingRef.current) return;
        const dx = ev.clientX - startXRef.current;
        let newW = startWidthRef.current + dx;
        const min = 160;
        const max = Math.min(window.innerWidth * 0.6, 800);
        if (newW < min) newW = min;
        if (newW > max) newW = max;
        setWidth(newW);
      };
      const onUp = () => {
        if (!resizingRef.current) return;
        resizingRef.current = false;
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
        window.removeEventListener("mouseleave", onUp);
        const w = finalWidthRef.current;
        localStorage.setItem("assetTreeWidth", String(w));
        // Trigger custom event
        window.dispatchEvent(new Event("asset-tree-resize"));
      };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
      window.addEventListener("mouseleave", onUp);
    };
    // ====== end Resizable width ======

    // Add host / folder
    const [addHostModalVisible, setAddHostModalVisible] = useState(false);
    const [addHostParentId, setAddHostParentId] = useState<string | null>(null);
    const [editingAsset, setEditingAsset] = useState<Asset | null>(null);
    const [addFolderDialogOpen, setAddFolderDialogOpen] = useState(false);
    const [newFolderName, setNewFolderName] = useState("");
    const [newFolderParentId, setNewFolderParentId] = useState<string | null>(
      null,
    );

    // Docker containers state: map of assetId -> containers
    const [dockerContainers, setDockerContainers] = useState<Record<string, ContainerInfo[]>>({});
    const [loadingContainers, setLoadingContainers] = useState<Record<string, boolean>>({});

    // Load containers for a Docker host
    const loadDockerContainers = useCallback(async (assetId: string, showAll = true) => {
      if (loadingContainers[assetId]) return;
      setLoadingContainers(prev => ({ ...prev, [assetId]: true }));
      try {
        const resp = await fetch(getApiUrl(`/api/assets/${assetId}/docker/containers?all=${showAll}`));
        if (resp.ok) {
          const data = await resp.json();
          if (data.code === 200 && data.data?.containers) {
            setDockerContainers(prev => ({ ...prev, [assetId]: data.data.containers }));
          }
        }
      } catch (e) {
        console.error("Failed to load containers:", e);
      } finally {
        setLoadingContainers(prev => ({ ...prev, [assetId]: false }));
      }
    }, [loadingContainers]);

    // Context menu
    const treeMenuAnchor = useRef<HTMLElement | null>(null);
    const [contextNode, setContextNode] = useState<HostNode | null>(null);
    const [menuOpen, setMenuOpen] = useState(false);

    // Rename dialog
    const [renameDialogOpen, setRenameDialogOpen] = useState(false);
    const [renameValue, setRenameValue] = useState("");
    const [renamingAssetId, setRenamingAssetId] = useState<string | null>(null);

    // Move dialog
    const [moveDialogOpen, setMoveDialogOpen] = useState(false);
    const [moveTargetParent, setMoveTargetParent] = useState<string | null>(
      null,
    );
    const [movePosition, setMovePosition] = useState<
      "append" | "before" | "after"
    >("append");
    const [moveReferenceSibling, setMoveReferenceSibling] = useState<
      string | null
    >(null);
    const [moveError, setMoveError] = useState<string>("");
    const [dragOverId, setDragOverId] = useState<string | null>(null);
    const [dragIntent, setDragIntent] = useState<
      "before" | "after" | "append" | "invalid" | null
    >(null);

    // Drag and drop
    const dragNodeIdRef = useRef<string | null>(null);
    const draggedAssetRef = useRef<Asset | null>(null); // cache dragged asset to avoid reference loss when filter changes or Safari issues

    // ===== Folder options & path display =====
    const folderTreeItems = useMemo(() => {
      const folders = allAssets.filter((a) => a.type === "folder");
      const childrenMap: Record<string, Asset[]> = {};
      folders.forEach((f) => {
        const pid = f.parent_id || "__root__";
        (childrenMap[pid] ||= []).push(f);
      });
      Object.values(childrenMap).forEach((arr) =>
        arr.sort((a, b) => a.name.localeCompare(b.name)),
      );
      const res: { id: string; name: string; depth: number }[] = [];
      const dfs = (parentKey: string, depth: number) => {
        const arr = childrenMap[parentKey];
        if (!arr) return;
        arr.forEach((f) => {
          res.push({ id: f.id, name: f.name, depth });
          dfs(f.id, depth + 1);
        });
      };
      // Start depth at 1 so first-level folder shows indentation relative to root
      dfs("__root__", 1);
      return res;
    }, [allAssets]);

    const getFolderPath = (id: string): string => {
      const idMap: Record<string, Asset> = {};
      allAssets.forEach((a) => {
        idMap[a.id] = a;
      });
      const parts: string[] = [];
      const guard = new Set<string>();
      let cur = idMap[id];
      while (cur && !guard.has(cur.id)) {
        parts.push(cur.name);
        guard.add(cur.id);
        if (!cur.parent_id) break;
        cur = idMap[cur.parent_id];
      }
      return parts.reverse().join("/");
    };

    const selectedParentPath = useMemo(() => {
      if (!newFolderParentId) return "";
      return getFolderPath(newFolderParentId);
    }, [newFolderParentId, allAssets]);
    // ===== end =====

    // Expose refresh to parent
    useImperativeHandle(ref, () => ({ refresh: () => fetchAssets() }), []);

    // Load assets
    const fetchAssets = async () => {
      setLoading(true);
      setError("");
      try {
        const resp = await fetch(getApiUrl("/api/assets"));
        if (!resp.ok) {
          setError(`HTTP ${resp.status}`);
          setAllAssets([]);
          setAssets([]);
          return;
        }
        const result: ApiResponse<AssetListResponse> = await resp.json();
        const list =
          (result.data as any)?.assets || (result.data as any)?.Assets || [];
        const full: Asset[] = Array.isArray(list) ? list : [];
        setAllAssets(full);
        const visible = computeVisibleAssets(full, search, typeFilter);
        setAssets(visible);
      } catch (e: any) {
        setError(e.message || String(e));
        setAllAssets([]);
        setAssets([]);
      } finally {
        setLoading(false);
      }
    };
    useEffect(() => {
      fetchAssets();
    }, []);

    useEffect(() => {
      // recompute visible when search or type changes without forcing re-fetch
      const visible = computeVisibleAssets(allAssets, search, typeFilter);
      setAssets(visible);
    }, [search, typeFilter, allAssets]);

    // Compute matches plus ancestors
    const computeVisibleAssets = (
      full: Asset[],
      searchValue: string,
      typeValue: string,
    ): Asset[] => {
      if (!full || full.length === 0) return [];
      let base = full;
      if (typeValue !== "all") {
        base = base.filter((a) => a.type === typeValue);
      }
      const q = searchValue.trim().toLowerCase();
      // Only type filter, no search: include ancestors of matching assets (folders)
      if (!q) {
        if (typeValue === "all") return base;
        const idMap: Record<string, Asset> = {};
        full.forEach((a) => {
          idMap[a.id] = a;
        });
        const includeSet = new Set<string>(base.map((a) => a.id));
        const addAncestors = (id: string) => {
          let cur: Asset | undefined = idMap[id];
          const guard = new Set<string>();
          while (cur && cur.parent_id) {
            if (guard.has(cur.id)) break;
            guard.add(cur.id);
            const pid = cur.parent_id;
            if (pid && !includeSet.has(pid)) includeSet.add(pid);
            cur = pid ? idMap[pid] : undefined;
          }
        };
        base.forEach((a) => addAncestors(a.id));
        return full.filter((a) => includeSet.has(a.id));
      }
      // Search logic below
      const matchSet = new Set<string>();
      const idMap: Record<string, Asset> = {};
      full.forEach((a) => {
        idMap[a.id] = a;
      });
      const matchAsset = (a: Asset): boolean => {
        return (
          a.name.toLowerCase().includes(q) ||
          (a.description || "").toLowerCase().includes(q) ||
          (!!a.tags && a.tags.some((t) => t.toLowerCase().includes(q)))
        );
      };
      // Iterate full instead of type-filtered base so ancestor relations are intact
      full.forEach((a) => {
        if (matchAsset(a)) matchSet.add(a.id);
      });
      if (matchSet.size === 0) return [];
      const includeSet = new Set<string>([...matchSet]);
      const addAncestorFolders = (asset: Asset) => {
        const guard = new Set<string>();
        let cur = asset.parent_id ? idMap[asset.parent_id] : undefined;
        while (cur && !guard.has(cur.id)) {
          guard.add(cur.id);
          if (cur.type === "folder") includeSet.add(cur.id);
          cur = cur.parent_id ? idMap[cur.parent_id] : undefined;
        }
      };
      matchSet.forEach((id) => {
        const a = idMap[id];
        if (a) addAncestorFolders(a);
      });
      // Final filter: if type set, keep matched assets of that type + their ancestor folders (folders always kept)
      return full.filter(
        (a) =>
          includeSet.has(a.id) &&
          (typeValue === "all" || a.type === "folder" || a.type === typeValue),
      );
    };

    // Prepare matched ID set for highlight (based on current search + type filter)
    const matchedIDs = React.useMemo(() => {
      const q = search.trim().toLowerCase();
      if (!q) return new Set<string>();
      return new Set(
        assets
          .filter((a) => {
            const inName = a.name.toLowerCase().includes(q);
            const inDesc = (a.description || "").toLowerCase().includes(q);
            const inTags = a.tags?.some((t) => t.toLowerCase().includes(q));
            return inName || inDesc || inTags;
          })
          .map((a) => a.id),
      );
    }, [search, assets]);

    // Rebuild order via linked list relations
    const convertAssetsToTreeData = (list: Asset[]): HostNode[] => {
      // Build tree from current filtered list
      const normParent = (p: string | null | undefined) => (p ? p : null);
      const siblingsMap: Record<string, Asset[]> = {};
      list.forEach((a) => {
        const k = normParent(a.parent_id) ?? "__root__";
        (siblingsMap[k] ||= []).push(a);
      });
      const orderSiblings = (arr: Asset[]): Asset[] => {
        if (arr.length === 0) return arr;
        const idx: Record<string, Asset> = {};
        arr.forEach((a) => (idx[a.id] = a));
        // Head nodes: prev_id empty or prev not in current set
        let heads = arr.filter((a) => !a.prev_id || !idx[a.prev_id]);
        // Stable sort: first by created_at then by name
        const stableKey = (a: Asset) =>
          `${a.created_at || ""}\u0000${a.name.toLowerCase()}`;
        heads = heads.sort((a, b) => stableKey(a).localeCompare(stableKey(b)));
        const visited = new Set<string>();
        const ordered: Asset[] = [];
        heads.forEach((h) => {
          let cur: Asset | undefined = h;
          // traverse list preserving next_id order
          while (cur && !visited.has(cur.id)) {
            ordered.push(cur);
            visited.add(cur.id);
            cur = cur.next_id ? idx[cur.next_id] : undefined;
            // stop if next points outside set or forms a loop
            if (cur && !idx[cur.id]) break;
            if (cur && cur.next_id === cur.id) break;
          }
        });
        // Remaining unvisited nodes (broken chains or loops) appended with stable sort
        const leftovers = arr
          .filter((a) => !visited.has(a.id))
          .sort((a, b) => stableKey(a).localeCompare(stableKey(b)));
        leftovers.forEach((l) => ordered.push(l));
        return ordered;
      };
      const build = (parent: string | null | undefined): HostNode[] => {
        const parentKey = normParent(parent) ?? "__root__";
        const ordered = orderSiblings(siblingsMap[parentKey] || []);
        return ordered.map((a) => {
          const isMatch = matchedIDs.has(a.id);

          // Determine icon based on asset type
          let icon: React.ReactNode;
          if (a.type === "folder") {
            icon = <FolderIcon fontSize="small" />;
          } else if (a.type === "ssh") {
            icon = <LanIcon fontSize="small" />;
          } else if (a.type === "docker_host") {
            icon = <ViewInArIcon fontSize="small" />;
          } else {
            // local
            icon = <ComputerIcon fontSize="small" />;
          }

          const commonProps = {
            title: a.name,
            key: a.id,
            asset: a,
            isLeaf: a.type !== "folder" && a.type !== "docker_host",
            icon,
          } as HostNode;

          if (a.type === "folder") {
            return {
              ...commonProps,
              children: build(a.id),
              title: isMatch ? `${a.name}` : a.name,
            };
          } else if (a.type === "docker_host") {
            // Docker host has dynamic children (containers)
            const containers = dockerContainers[a.id] || [];
            const containerChildren: HostNode[] = containers.map((c) => {
              // Determine container state icon color
              const stateColor = c.state === "running" ? "#4caf50"
                : c.state === "paused" ? "#ff9800"
                : c.state === "exited" ? "#9e9e9e"
                : "#f44336";

              return {
                title: c.name,
                key: `container_${a.id}_${c.id}`,
                isLeaf: true,
                icon: (
                  <Box display="flex" alignItems="center">
                    <Box
                      sx={{
                        width: 8,
                        height: 8,
                        borderRadius: "50%",
                        backgroundColor: stateColor,
                        mr: 0.5,
                      }}
                    />
                    <ViewInArIcon fontSize="small" sx={{ fontSize: 16 }} />
                  </Box>
                ),
                containerInfo: c,
                dockerHostAssetId: a.id,
              };
            });

            return {
              ...commonProps,
              isLeaf: false,
              isDynamic: true,
              dynamicLoaded: containers.length > 0,
              children: loadingContainers[a.id]
                ? [{ title: "Loading...", key: `loading_${a.id}`, isLeaf: true, icon: <CircularProgress size={14} /> }]
                : containerChildren,
            };
          } else {
            const node: HostNode = { ...commonProps };
            const info = extractHostInfo(a);
            if (info) {
              node.ip = info.host;
              node.port = info.port;
            }
            return node;
          }
        });
      };
      return build(null);
    };

    const treeData = useMemo(() => convertAssetsToTreeData(assets), [assets, matchedIDs, dockerContainers, loadingContainers]);

    // Double click connect
    const handleNodeDoubleClick = (node: HostNode) => {
      // Folder: do nothing (expand/collapse handled by tree)
      if (node.asset?.type === "folder") return;

      // Docker host: load containers if not loaded
      if (node.asset?.type === "docker_host") {
        if (!dockerContainers[node.asset.id]) {
          loadDockerContainers(node.asset.id);
        }
        return; // Don't open terminal for docker host itself
      }

      // Container node: open terminal
      if (node.containerInfo && node.dockerHostAssetId) {
        const event = new CustomEvent("docker-container-connect", {
          detail: {
            dockerHostAssetId: node.dockerHostAssetId,
            container: node.containerInfo,
          },
        });
        window.dispatchEvent(event);
        return;
      }

      // Regular asset (local, ssh): open terminal
      if (!node.asset) return;
      const event = new CustomEvent("asset-connect", {
        detail: { asset: node.asset, node },
      });
      window.dispatchEvent(event);
    };

    // Context menu
    const handleContextMenu = (
      event: React.MouseEvent<HTMLElement>,
      node: HostNode,
    ) => {
      event.preventDefault();
      setContextNode(node);
      treeMenuAnchor.current = event.currentTarget;
      setMenuOpen(true);
    };
    const closeMenu = () => {
      setMenuOpen(false);
      setContextNode(null);
    };

    // Create folder
    const createFolder = async () => {
      if (!newFolderName.trim()) return;
      const body = {
        name: newFolderName.trim(),
        type: "folder",
        description: "",
        config: {},
        tags: [],
        parent_id: newFolderParentId,
      };
      try {
        const resp = await fetch(getApiUrl("/api/assets"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (resp.ok) {
          await fetchAssets();
        }
      } catch {}
      setAddFolderDialogOpen(false);
      setNewFolderName("");
    };

    // Delete node
    const deleteNode = async (node: HostNode) => {
      try {
        const resp = await fetch(getApiUrl(`/api/assets/${node.key}`), {
          method: "DELETE",
        });
        if (resp.ok) await fetchAssets();
      } catch {}
      closeMenu();
    };

    // Rename
    const openRenameDialog = () => {
      if (!contextNode?.asset) return;
      setRenamingAssetId(contextNode.asset.id);
      setRenameValue(contextNode.asset.name);
      setRenameDialogOpen(true);
      closeMenu();
    };
    const submitRename = async () => {
      if (!renamingAssetId) return;
      try {
        const resp = await fetch(getApiUrl(`/api/assets/${renamingAssetId}`), {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: renameValue }),
        });
        if (resp.ok) await fetchAssets();
      } catch {}
      setRenameDialogOpen(false);
      setRenamingAssetId(null);
      setRenameValue("");
    };

    // Move logic
    const foldersOnly = assets.filter((a) => a.type === "folder");
    const siblingOptions = (parentId: string | null) =>
      assets.filter(
        (a) => a.parent_id === parentId && a.id !== contextNode?.asset?.id,
      );
    const submitMove = async () => {
      if (!contextNode?.asset) return;
      setMoveError("");
      const req: MoveRequest = {
        new_parent_id: moveTargetParent,
        position: movePosition,
        target_sibling_id: moveReferenceSibling,
      };
      if (movePosition === "append") req.target_sibling_id = null;
      try {
        const resp = await fetch(
          getApiUrl(`/api/assets/${contextNode.asset.id}/move`),
          {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(req),
          },
        );
        const j = await resp
          .json()
          .catch(() => ({ code: resp.status, message: resp.statusText }));
        if (!resp.ok || j.code !== 200) {
          setMoveError(j.message || `Move failed: HTTP ${resp.status}`);
          return;
        }
        await fetchAssets();
        setMoveDialogOpen(false);
      } catch (e: any) {
        setMoveError(e.message || String(e));
      }
    };

    // Drag start
    const onDragStart = (e: React.DragEvent, node: HostNode) => {
      dragNodeIdRef.current = node.key;
      draggedAssetRef.current = node.asset || null;
      try {
        e.dataTransfer.setData("application/x-asset-id", node.key);
        e.dataTransfer.setData("text/plain", node.key);
      } catch {}
      e.dataTransfer.effectAllowed = "move";
      DEBUG_DND && console.log("[DND] dragStart", node.key);
    };
    // Root drag over/drop (move into root)
    const onRootDragOver = (e: React.DragEvent) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
    };
    const onRootDrop = async (e: React.DragEvent) => {
      e.preventDefault();
      let draggedId = dragNodeIdRef.current;
      if (!draggedId) {
        // Fallback for Safari
        draggedId =
          e.dataTransfer.getData("application/x-asset-id") ||
          e.dataTransfer.getData("text/plain");
      }
      dragNodeIdRef.current = null;
      if (!draggedId) return;
      await performMove(draggedId, null, "append", null);
      clearDragHover();
    };
    // Node drop
    const onDrop = async (e: React.DragEvent, target: HostNode) => {
      e.preventDefault();
      e.stopPropagation(); // prevent bubbling to root causing second move
      let draggedId = dragNodeIdRef.current;
      if (!draggedId) {
        draggedId =
          e.dataTransfer.getData("application/x-asset-id") ||
          e.dataTransfer.getData("text/plain");
      }
      const cachedAsset = draggedAssetRef.current;
      dragNodeIdRef.current = null;
      draggedAssetRef.current = null;
      if (!draggedId || !target.asset) {
        clearDragHover();
        return;
      }
      const draggedAsset =
        cachedAsset || assets.find((a) => a.id === draggedId);
      if (!draggedAsset) {
        clearDragHover();
        return;
      }

      // Recalculate intent (some browsers may lose stored dragIntent)
      let effectiveIntent = dragIntent;
      if (!effectiveIntent) {
        // Recompute based on cursor
        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
        const y = e.clientY - rect.top;
        const ratio = y / rect.height;
        if (target.asset.type === "folder") {
          if (ratio < 0.33) effectiveIntent = "before";
          else if (ratio > 0.66) effectiveIntent = "after";
          else effectiveIntent = "append";
        } else {
          effectiveIntent = ratio > 0.5 ? "after" : "before";
        }
      }

      // Fix invalid fallback
      if (effectiveIntent === "invalid") {
        if (
          target.asset.type === "folder" &&
          !isDescendant(target.asset.id, draggedAsset.id)
        )
          effectiveIntent = "append";
        else {
          clearDragHover();
          return;
        }
      }

      const targetAsset = target.asset;
      let newParent: string | null = draggedAsset.parent_id;
      let position: MoveRequest["position"] = "before";
      let siblingRef: string | null = targetAsset.id;

      if (effectiveIntent === "append") {
        if (targetAsset.type !== "folder") {
          clearDragHover();
          return;
        }
        if (isDescendant(targetAsset.id, draggedAsset.id)) {
          clearDragHover();
          return;
        }
        newParent = targetAsset.id;
        position = "append";
        siblingRef = null;
      } else if (effectiveIntent === "before" || effectiveIntent === "after") {
        if (draggedAsset.id === targetAsset.id) {
          clearDragHover();
          return;
        }
        newParent = targetAsset.parent_id;
        position = effectiveIntent;
        siblingRef = targetAsset.id;
      } else {
        clearDragHover();
        return;
      }

      DEBUG_DND &&
        console.log("[DND] drop -> move", {
          draggedId,
          to: newParent,
          position,
          siblingRef,
          intent: effectiveIntent,
        });
      await performMove(draggedAsset.id, newParent, position, siblingRef);
      clearDragHover();
    };
    const onDragEnter = (e: React.DragEvent, node: HostNode) => {
      const draggedId = dragNodeIdRef.current;
      if (!draggedId) return;
      const targetAsset = node.asset;
      if (!targetAsset) return;
      const draggedAsset = assets.find((a) => a.id === draggedId);
      if (!draggedAsset) return;
      if (draggedAsset.id === targetAsset.id) {
        setDragOverId(node.key);
        return;
      }
      setDragOverId(node.key);
      DEBUG_DND && console.log("[DND] dragEnter", draggedId, "->", node.key);
    };
    const onDragOverNode = (e: React.DragEvent, node: HostNode) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      const draggedId = dragNodeIdRef.current;
      if (!draggedId) return;
      const targetAsset = node.asset;
      const draggedAsset = assets.find((a) => a.id === draggedId);
      if (!targetAsset || !draggedAsset) {
        setDragIntent(null);
        return;
      }
      if (draggedAsset.id === targetAsset.id) {
        setDragIntent("invalid");
        return;
      }
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      const y = e.clientY - rect.top;
      const ratio = y / rect.height;
      let intent: "before" | "after" | "append" | "invalid";
      if (targetAsset.type === "folder") {
        if (e.altKey) {
          intent = ratio > 0.5 ? "after" : "before";
        } else {
          if (ratio < 0.33) intent = "before";
          else if (ratio > 0.66) intent = "after";
          else intent = "append";
          if (
            intent === "append" &&
            isDescendant(targetAsset.id, draggedAsset.id)
          )
            intent = "invalid";
        }
      } else {
        intent = ratio > 0.5 ? "after" : "before";
      }
      setDragIntent(intent);
      setDragOverId(node.key);
      DEBUG_DND &&
        console.log(
          "[DND] dragOver",
          draggedId,
          "on",
          node.key,
          "intent:",
          intent,
        );
    };
    const clearDragHover = () => {
      setDragOverId(null);
      setDragIntent(null);
    };
    const onDragLeave = (e: React.DragEvent, node: HostNode) => {
      if (dragOverId === node.key) clearDragHover();
    };

    // Generic move helper (used for root drops etc.)
    const performMove = async (
      assetId: string,
      newParent: string | null,
      position: MoveRequest["position"] = "append",
      siblingId: string | null = null,
    ): Promise<boolean> => {
      const req: MoveRequest = {
        new_parent_id: newParent,
        position,
        target_sibling_id: siblingId,
      };
      if (position === "append") req.target_sibling_id = null;
      try {
        const resp = await fetch(getApiUrl(`/api/assets/${assetId}/move`), {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(req),
        });
        if (!resp.ok) {
          DEBUG_DND &&
            console.error("[DND] move failed HTTP", resp.status, req);
          return false;
        }
        const j = await resp.json().catch(() => ({ code: resp.status }));
        const ok = j.code === 200 || j.code === undefined || j.code === 0;
        if (!ok) {
          DEBUG_DND && console.error("[DND] move failed body", j);
          return false;
        }
        await fetchAssets();
        return true;
      } catch (e: any) {
        DEBUG_DND && console.error("[DND] move error", e);
        return false;
      }
    };

    // Check if target is descendant of dragged (prevent invalid moves)
    const isDescendant = (targetId: string, draggedId: string): boolean => {
      if (targetId === draggedId) return true;
      const idMap: Record<string, Asset> = {};
      assets.forEach((a) => {
        idMap[a.id] = a;
      });
      // Walk upward from target to root looking for draggedId
      const visitStack: string[] = [targetId];
      const guard = new Set<string>();
      while (visitStack.length) {
        const curId = visitStack.pop()!;
        if (guard.has(curId)) continue;
        guard.add(curId);
        if (curId === draggedId) return true;
        const curAsset = idMap[curId];
        if (curAsset && curAsset.parent_id) visitStack.push(curAsset.parent_id);
      }
      return false;
    };

    // Context menu capability checks
    const canConnect =
      !!contextNode?.asset && contextNode.asset.type !== "folder" && contextNode.asset.type !== "docker_host";
    const canConnectContainer = !!contextNode?.containerInfo;
    const canRename = !!contextNode?.asset;
    const canDelete = !!contextNode?.asset || !!contextNode?.containerInfo;
    const canAddHostHere = contextNode?.asset?.type === "folder";
    const canAddFolderHere = contextNode?.asset?.type === "folder";
    const isDockerHost = contextNode?.asset?.type === "docker_host";
    const isContainer = !!contextNode?.containerInfo;
    const containerRunning = contextNode?.containerInfo?.state === "running";

    // Refresh containers for Docker host
    const handleRefreshContainers = () => {
      if (contextNode?.asset?.id) {
        loadDockerContainers(contextNode.asset.id);
      }
      closeMenu();
    };

    // Container actions
    const handleContainerAction = async (action: "start" | "stop" | "restart") => {
      if (!contextNode?.containerInfo || !contextNode?.dockerHostAssetId) return;
      try {
        await fetch(
          getApiUrl(`/api/assets/${contextNode.dockerHostAssetId}/docker/containers/${contextNode.containerInfo.id}/${action}`),
          { method: "POST" }
        );
        // Refresh containers after action
        loadDockerContainers(contextNode.dockerHostAssetId);
      } catch (e) {
        console.error(`Failed to ${action} container:`, e);
      }
      closeMenu();
    };

    const onDragEnd = () => {
      dragNodeIdRef.current = null;
      draggedAssetRef.current = null;
      clearDragHover();
    };

    return (
      <Box
        display="flex"
        flexDirection="column"
        height="100%"
        sx={{
          borderRight: "1px solid #e5e5e5",
          position: "relative",
          width,
          flexShrink: 0,
        }}
      >
        {/* Resize handle */}
        <Box
          onMouseDown={handleResizeMouseDown}
          sx={{
            position: "absolute",
            top: 0,
            right: 0,
            height: "100%",
            width: "6px",
            cursor: "col-resize",
            zIndex: 10,
            "&:hover": { backgroundColor: "rgba(0,0,0,0.05)" },
            touchAction: "none",
          }}
        />
        {/* Toolbar */}
        <Box display="flex" alignItems="center" gap={1} px={1} py={0.5}>
          {/*<Typography variant="subtitle2" flex={0}>Assets</Typography>*/}
          <FormControl size="small">
            {/*<InputLabel id="type-filter-label">Type</InputLabel>*/}
            <Select
              labelId="type-filter-label"
              value={typeFilter}
              placeholder="Type"
              onChange={(e) => setTypeFilter(e.target.value)}
            >
              <MenuItem value="all">All</MenuItem>
              <MenuItem value="ssh">SSH</MenuItem>
              <MenuItem value="local">Local</MenuItem>
              <MenuItem value="docker_host">Docker</MenuItem>
            </Select>
          </FormControl>
          <IconButton
            size="small"
            onClick={() => fetchAssets()}
            disabled={loading}
          >
            <RefreshIcon fontSize="small" />
          </IconButton>
          <IconButton
            size="small"
            onClick={(e) => setSearchAnchorEl(e.currentTarget)}
          >
            <SearchIcon fontSize="small" />
          </IconButton>
          <IconButton
            size="small"
            onClick={() => {
              setNewFolderParentId(null);
              setEditingAsset(null);
              setAddHostModalVisible(true);
            }}
          >
            <AddIcon fontSize="small" />
          </IconButton>
        </Box>
        {error && (
          <Typography color="error" px={1} variant="caption">
            {error}
          </Typography>
        )}

        {/* Tree */}
        <Box
          flex={1}
          overflow="auto"
          px={0.5}
          onDragOver={onRootDragOver}
          onDrop={onRootDrop}
        >
          <SimpleTreeView
            onExpandedItemsChange={(event, itemIds) => {
              // When a Docker host is expanded, load its containers
              itemIds.forEach((itemId) => {
                const asset = allAssets.find((a) => a.id === itemId);
                if (asset?.type === "docker_host" && !dockerContainers[itemId] && !loadingContainers[itemId]) {
                  loadDockerContainers(itemId);
                }
              });
            }}
          >
            {treeData.map((node) => (
              <XTreeItem
                key={node.key}
                itemId={node.key}
                label={
                  <Box
                    data-asset-id={node.key}
                    width="100%"
                    display="flex"
                    alignItems="center"
                    onContextMenu={(e) => handleContextMenu(e, node)}
                    onDoubleClick={() => handleNodeDoubleClick(node)}
                    draggable
                    onDragStart={(e) => onDragStart(e, node)}
                    onDragEnter={(e) => onDragEnter(e, node)}
                    onDragOver={(e) => onDragOverNode(e, node)}
                    onDragLeave={(e) => onDragLeave(e, node)}
                    onDrop={(e) => onDrop(e, node)}
                    onDragEnd={onDragEnd}
                    style={{
                      userSelect: "none",
                      WebkitUserSelect: "none",
                      MozUserSelect: "none",
                    }}
                    sx={
                      dragOverId === node.key
                        ? dragIntent === "before"
                          ? {
                              borderTop: "2px solid #2196f3",
                              backgroundColor: "rgba(33,150,243,0.05)",
                              borderRadius: 1,
                              WebkitUserDrag: "element",
                            }
                          : dragIntent === "after"
                            ? {
                                borderBottom: "2px solid #2196f3",
                                backgroundColor: "rgba(33,150,243,0.05)",
                                borderRadius: 1,
                                WebkitUserDrag: "element",
                              }
                            : dragIntent === "append"
                              ? {
                                  backgroundColor: "rgba(33,150,243,0.20)",
                                  borderRadius: 1,
                                  WebkitUserDrag: "element",
                                }
                              : {
                                  backgroundColor: "rgba(244,67,54,0.30)",
                                  borderRadius: 1,
                                  WebkitUserDrag: "element",
                                }
                        : matchedIDs.has(node.key)
                          ? {
                              backgroundColor: "rgba(255,235,59,0.25)",
                              borderRadius: 1,
                              WebkitUserDrag: "element",
                            }
                          : { WebkitUserDrag: "element" }
                    }
                  >
                    {node.icon}
                    <Box
                      ml={0.5}
                      fontWeight={matchedIDs.has(node.key) ? 600 : 400}
                    >
                      {node.title}
                    </Box>
                  </Box>
                }
              >
                {node.children?.map((child) => (
                  <XTreeItem
                    key={child.key}
                    itemId={child.key}
                    label={
                      <Box
                        data-asset-id={child.key}
                        width="100%"
                        display="flex"
                        alignItems="center"
                        onContextMenu={(e) => handleContextMenu(e, child)}
                        onDoubleClick={() => handleNodeDoubleClick(child)}
                        draggable
                        onDragStart={(e) => onDragStart(e, child)}
                        onDragEnter={(e) => onDragEnter(e, child)}
                        onDragOver={(e) => onDragOverNode(e, child)}
                        onDragLeave={(e) => onDragLeave(e, child)}
                        onDrop={(e) => onDrop(e, child)}
                        onDragEnd={onDragEnd}
                        style={{
                          userSelect: "none",
                          WebkitUserSelect: "none",
                          MozUserSelect: "none",
                        }}
                        sx={
                          dragOverId === child.key
                            ? dragIntent === "before"
                              ? {
                                  borderTop: "2px solid #2196f3",
                                  backgroundColor: "rgba(33,150,243,0.05)",
                                  borderRadius: 1,
                                  WebkitUserDrag: "element",
                                }
                              : dragIntent === "after"
                                ? {
                                    borderBottom: "2px solid #2196f3",
                                    backgroundColor: "rgba(33,150,243,0.05)",
                                    borderRadius: 1,
                                    WebkitUserDrag: "element",
                                  }
                                : dragIntent === "append"
                                  ? {
                                      backgroundColor: "rgba(33,150,243,0.20)",
                                      borderRadius: 1,
                                      WebkitUserDrag: "element",
                                    }
                                  : {
                                      backgroundColor: "rgba(244,67,54,0.30)",
                                      borderRadius: 1,
                                      WebkitUserDrag: "element",
                                    }
                            : matchedIDs.has(child.key)
                              ? {
                                  backgroundColor: "rgba(255,235,59,0.25)",
                                  borderRadius: 1,
                                  WebkitUserDrag: "element",
                                }
                              : { WebkitUserDrag: "element" }
                        }
                      >
                        {child.icon}
                        <Box
                          ml={0.5}
                          fontWeight={matchedIDs.has(child.key) ? 600 : 400}
                        >
                          {child.title}
                        </Box>
                      </Box>
                    }
                  >
                    {child.children?.map((grand) => (
                      <XTreeItem
                        key={grand.key}
                        itemId={grand.key}
                        label={
                          <Box
                            data-asset-id={grand.key}
                            width="100%"
                            display="flex"
                            alignItems="center"
                            onContextMenu={(e) => handleContextMenu(e, grand)}
                            onDoubleClick={() => handleNodeDoubleClick(grand)}
                            draggable
                            onDragStart={(e) => onDragStart(e, grand)}
                            onDragEnter={(e) => onDragEnter(e, grand)}
                            onDragOver={(e) => onDragOverNode(e, grand)}
                            onDragLeave={(e) => onDragLeave(e, grand)}
                            onDrop={(e) => onDrop(e, grand)}
                            onDragEnd={onDragEnd}
                            style={{
                              userSelect: "none",
                              WebkitUserSelect: "none",
                              MozUserSelect: "none",
                            }}
                            sx={
                              dragOverId === grand.key
                                ? dragIntent === "before"
                                  ? {
                                      borderTop: "2px solid #2196f3",
                                      backgroundColor: "rgba(33,150,243,0.05)",
                                      borderRadius: 1,
                                      WebkitUserDrag: "element",
                                    }
                                  : dragIntent === "after"
                                    ? {
                                        borderBottom: "2px solid #2196f3",
                                        backgroundColor:
                                          "rgba(33,150,243,0.05)",
                                        borderRadius: 1,
                                        WebkitUserDrag: "element",
                                      }
                                    : dragIntent === "append"
                                      ? {
                                          backgroundColor:
                                            "rgba(33,150,243,0.20)",
                                          borderRadius: 1,
                                          WebkitUserDrag: "element",
                                        }
                                      : {
                                          backgroundColor:
                                            "rgba(244,67,54,0.30)",
                                          borderRadius: 1,
                                          WebkitUserDrag: "element",
                                        }
                                : matchedIDs.has(grand.key)
                                  ? {
                                      backgroundColor: "rgba(255,235,59,0.25)",
                                      borderRadius: 1,
                                      WebkitUserDrag: "element",
                                    }
                                  : { WebkitUserDrag: "element" }
                            }
                          >
                            {grand.icon}
                            <Box
                              ml={0.5}
                              fontWeight={matchedIDs.has(grand.key) ? 600 : 400}
                            >
                              {grand.title}
                            </Box>
                          </Box>
                        }
                      />
                    ))}
                  </XTreeItem>
                ))}
              </XTreeItem>
            ))}
          </SimpleTreeView>
        </Box>

        {/* Context menu */}
        <MuiMenu
          open={menuOpen}
          anchorEl={treeMenuAnchor.current}
          onClose={closeMenu}
          slotProps={{
            paper: {
              sx: {
                minWidth: 160,
                "& .MuiMenuItem-root": {
                  py: 0.5,
                  px: 1.25,
                  fontSize: 12,
                  minHeight: 24,
                },
                "& .MuiSvgIcon-root": {
                  fontSize: 16,
                  marginRight: 1,
                },
              },
            },
          }}
        >
          {/* Regular connect for SSH/Local */}
          {canConnect && (
            <MenuItem
              onClick={() => {
                if (contextNode) handleNodeDoubleClick(contextNode);
                closeMenu();
              }}
            >
              <OpenInNewIcon fontSize="small" style={{ marginRight: 8 }} />
              Connect
            </MenuItem>
          )}
          {/* Container connect */}
          {canConnectContainer && (
            <MenuItem
              onClick={() => {
                if (contextNode) handleNodeDoubleClick(contextNode);
                closeMenu();
              }}
            >
              <OpenInNewIcon fontSize="small" style={{ marginRight: 8 }} />
              Open Terminal
            </MenuItem>
          )}
          {/* Docker host: refresh containers */}
          {isDockerHost && (
            <MenuItem onClick={handleRefreshContainers}>
              <RefreshIcon fontSize="small" style={{ marginRight: 8 }} />
              Refresh Containers
            </MenuItem>
          )}
          {/* Container actions */}
          {isContainer && !containerRunning && (
            <MenuItem onClick={() => handleContainerAction("start")}>
              <PlayArrowIcon fontSize="small" style={{ marginRight: 8, color: "#4caf50" }} />
              Start Container
            </MenuItem>
          )}
          {isContainer && containerRunning && (
            <MenuItem onClick={() => handleContainerAction("stop")}>
              <StopIcon fontSize="small" style={{ marginRight: 8, color: "#f44336" }} />
              Stop Container
            </MenuItem>
          )}
          {isContainer && (
            <MenuItem onClick={() => handleContainerAction("restart")}>
              <RefreshIcon fontSize="small" style={{ marginRight: 8 }} />
              Restart Container
            </MenuItem>
          )}
          {canAddHostHere && (
            <MenuItem
              onClick={() => {
                setAddHostParentId(contextNode!.key);
                setAddHostModalVisible(true);
                closeMenu();
              }}
            >
              <AddIcon fontSize="small" style={{ marginRight: 8 }} />
              Add Host
            </MenuItem>
          )}
          {canAddFolderHere && (
            <MenuItem
              onClick={() => {
                setNewFolderParentId(contextNode!.key);
                setAddFolderDialogOpen(true);
                closeMenu();
              }}
            >
              <FolderIcon fontSize="small" style={{ marginRight: 8 }} />
              Add Folder
            </MenuItem>
          )}
          {canRename && (
            <MenuItem onClick={openRenameDialog}>
              <DriveFileRenameOutlineIcon
                fontSize="small"
                style={{ marginRight: 8 }}
              />
              Rename
            </MenuItem>
          )}
          {/* Edit asset */}
          {contextNode?.asset && contextNode.asset.type !== "folder" && (
            <MenuItem
              onClick={() => {
                setEditingAsset(contextNode!.asset!);
                setAddHostParentId(contextNode!.asset!.parent_id || null);
                setAddHostModalVisible(true);
                closeMenu();
              }}
            >
              <DriveFileRenameOutlineIcon
                fontSize="small"
                style={{ marginRight: 8 }}
              />
              Edit
            </MenuItem>
          )}
          {canDelete && (
            <MenuItem
              onClick={() => contextNode && deleteNode(contextNode)}
              style={{ color: "#c62828" }}
            >
              <DeleteIcon fontSize="small" style={{ marginRight: 8 }} />
              Delete
            </MenuItem>
          )}
        </MuiMenu>

        <AddHostDialog
          open={addHostModalVisible}
          parentId={addHostParentId || undefined}
          asset={editingAsset}
          onClose={() => {
            setAddHostModalVisible(false);
            setEditingAsset(null);
          }}
          onSuccess={() => fetchAssets()}
        />

        {/* New folder dialog */}
        <Dialog
          open={addFolderDialogOpen}
          onClose={() => setAddFolderDialogOpen(false)}
          maxWidth="xs"
          fullWidth
        >
          <DialogTitle>Create Folder</DialogTitle>
          <DialogContent>
            <Box display="flex" flexDirection="column" gap={2} mt={0.5}>
              <FormControl size="small" fullWidth>
                {/*<InputLabel id="parent-folder-label">Parent Folder</InputLabel>*/}
                <Select
                  labelId="parent-folder-label"
                  value={newFolderParentId || "root"}
                  placeholder="Parent Folder"
                  renderValue={(value) => {
                    if (value === "root") return "/";
                    if (typeof value === "string")
                      return "/" + getFolderPath(value);
                    return "";
                  }}
                  onChange={(e) => {
                    const v = e.target.value === "root" ? null : e.target.value;
                    setNewFolderParentId(v as string | null);
                  }}
                >
                  <MenuItem value="root">/</MenuItem>
                  {folderTreeItems.map((item) => (
                    <MenuItem key={item.id} value={item.id}>
                      <Box
                        pl={item.depth * 1.5}
                        display="flex"
                        alignItems="center"
                      >
                        <FolderIcon
                          fontSize="small"
                          style={{ marginRight: 4 }}
                        />
                        {item.name}
                      </Box>
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
              <TextField
                placeholder="Folder Name"
                fullWidth
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                autoFocus
              />
              <Typography variant="caption" color="text.secondary">
                Path: /
                {selectedParentPath
                  ? `${selectedParentPath}/${newFolderName || "(New Folder)"}`
                  : `${newFolderName || "(New Folder)"}`}
              </Typography>
            </Box>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setAddFolderDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="contained"
              onClick={createFolder}
              disabled={!newFolderName.trim()}
            >
              Create
            </Button>
          </DialogActions>
        </Dialog>

        {/* Rename dialog */}
        <Dialog
          open={renameDialogOpen}
          onClose={() => setRenameDialogOpen(false)}
          maxWidth="xs"
          fullWidth
        >
          <DialogTitle>Rename Asset</DialogTitle>
          <DialogContent>
            <TextField
              label="New Name"
              fullWidth
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              autoFocus
            />
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setRenameDialogOpen(false)}>Cancel</Button>
            <Button
              variant="contained"
              onClick={submitRename}
              disabled={!renameValue.trim()}
            >
              Save
            </Button>
          </DialogActions>
        </Dialog>

        {/* Move dialog (reserved) */}
        <Dialog
          open={moveDialogOpen}
          onClose={() => setMoveDialogOpen(false)}
          maxWidth="sm"
          fullWidth
        >
          <DialogTitle>Move Asset</DialogTitle>
          <DialogContent>
            <Box display="flex" flexDirection="column" gap={2}>
              <FormControl size="small" fullWidth>
                <InputLabel id="move-parent-label">Target Folder</InputLabel>
                <Select
                  labelId="move-parent-label"
                  value={moveTargetParent || "root"}
                  label="Target Folder"
                  onChange={(e) => {
                    const v = e.target.value === "root" ? null : e.target.value;
                    setMoveTargetParent(v);
                    setMoveReferenceSibling(null);
                  }}
                >
                  <MenuItem value="root">(Root)</MenuItem>
                  {foldersOnly.map((f) => (
                    <MenuItem key={f.id} value={f.id}>
                      {f.name}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
              <FormControl size="small" fullWidth>
                <InputLabel id="move-position-label">Position</InputLabel>
                <Select
                  labelId="move-position-label"
                  value={movePosition}
                  label="Position"
                  onChange={(e) => setMovePosition(e.target.value as any)}
                >
                  <MenuItem value="append">Append (End)</MenuItem>
                  <MenuItem value="before">Before Sibling</MenuItem>
                  <MenuItem value="after">After Sibling</MenuItem>
                </Select>
              </FormControl>
              {(movePosition === "before" || movePosition === "after") && (
                <FormControl size="small" fullWidth>
                  <InputLabel id="move-sibling-label">
                    Reference Sibling
                  </InputLabel>
                  <Select
                    labelId="move-sibling-label"
                    value={moveReferenceSibling || ""}
                    label="Reference Sibling"
                    onChange={(e) =>
                      setMoveReferenceSibling(e.target.value || null)
                    }
                  >
                    <MenuItem value="">(None)</MenuItem>
                    {siblingOptions(moveTargetParent).map((s) => (
                      <MenuItem key={s.id} value={s.id}>
                        {s.name}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
              )}
              {moveError && (
                <Typography variant="caption" color="error">
                  {moveError}
                </Typography>
              )}
            </Box>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setMoveDialogOpen(false)}>Cancel</Button>
            <Button variant="contained" onClick={submitMove}>
              Move
            </Button>
          </DialogActions>
        </Dialog>

        <Popover
          open={Boolean(searchAnchorEl)}
          anchorEl={searchAnchorEl}
          onClose={() => setSearchAnchorEl(null)}
          anchorOrigin={{ vertical: "bottom", horizontal: "left" }}
          transformOrigin={{ vertical: "top", horizontal: "left" }}
        >
          <Box p={1} display="flex" alignItems="center" gap={1}>
            <TextField
              size="small"
              placeholder="Search"
              value={search}
              autoFocus
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  setSearchAnchorEl(null);
                }
              }}
            />
            {search && (
              <IconButton size="small" onClick={() => setSearch("")}>
                <ClearIcon fontSize="small" />
              </IconButton>
            )}
          </Box>
        </Popover>
      </Box>
    );
  },
);

export default AssetTree;
