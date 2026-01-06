import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { List as VirtualList, type RowComponentProps } from "react-window";
import {
  Box,
  Breadcrumbs,
  CircularProgress,
  Divider,
  IconButton,
  InputAdornment,
  Link,
  ListItemButton,
  ListItemIcon,
  Menu,
  MenuItem,
  OutlinedInput,
  Tooltip,
  Typography,
} from "@mui/material";
import FolderIcon from "@mui/icons-material/Folder";
import InsertDriveFileIcon from "@mui/icons-material/InsertDriveFile";
import MoreVertIcon from "@mui/icons-material/MoreVert";
import ViewColumnIcon from "@mui/icons-material/ViewColumn";
import ViewAgendaIcon from "@mui/icons-material/ViewAgenda";
import SwapHorizIcon from "@mui/icons-material/SwapHoriz";
import SwapVertIcon from "@mui/icons-material/SwapVert";
import RefreshIcon from "@mui/icons-material/Refresh";
import VisibilityIcon from "@mui/icons-material/Visibility";
import VisibilityOffIcon from "@mui/icons-material/VisibilityOff";
import ChecklistIcon from "@mui/icons-material/Checklist";
import ArrowDropUpIcon from "@mui/icons-material/ArrowDropUp";
import ArrowDropDownIcon from "@mui/icons-material/ArrowDropDown";
import { NestedMenuItem } from "mui-nested-menu";

import { getAsset, type Asset } from "../../api/assets";
import {
  fsList,
  type FSEntry,
} from "../../api/fs";
import { tasksEnqueueTransfer, type TransferRequest } from "../../api/tasks";
import { useFileManagerList, useInvalidateFileManager } from "../../stores";

type LayoutMode = "horizontal" | "vertical";

type PaneId = "local" | "remote";

type PaneOrder = "remote-first" | "local-first";

type EntryColumn = "mode" | "size" | "mtime" | "name";

type SortKey = "name" | "size" | "mtime";
type SortDir = "asc" | "desc";

type ColumnWidths = Partial<Record<EntryColumn, number>>;

function readSortState(): { key: SortKey; dir: SortDir } {
  const raw = window.localStorage.getItem("choraleia:fileManager:sort");
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as any;
      const key = parsed?.key;
      const dir = parsed?.dir;
      if ((key === "name" || key === "size" || key === "mtime") && (dir === "asc" || dir === "desc")) {
        return { key, dir };
      }
    } catch {
      // ignore
    }
  }
  return { key: "name", dir: "asc" };
}

function readColumnWidths(): ColumnWidths {
  const raw = window.localStorage.getItem("choraleia:fileManager:colWidths");
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as any;
      if (parsed && typeof parsed === "object") return parsed as ColumnWidths;
    } catch {
      // ignore
    }
  }
  return {};
}

function clampInt(v: number, min: number, max: number): number {
  if (!Number.isFinite(v)) return min;
  return Math.max(min, Math.min(max, Math.round(v)));
}

function getColumnConstraints(col: EntryColumn): { min: number; max: number; default: number } {
  // Keep it compact but usable.
  if (col === "name") return { min: 160, max: 900, default: 320 };
  if (col === "mode") return { min: 72, max: 160, default: 84 };
  if (col === "size") return { min: 56, max: 160, default: 72 };
  if (col === "mtime") return { min: 120, max: 260, default: 140 };
  return { min: 80, max: 400, default: 120 };
}

const COLUMN_ORDER: EntryColumn[] = ["name", "mode", "size", "mtime"];

export type FileManagerHeaderActionPayload = {
  layout: LayoutMode;
  toggleLayout: () => void;
};

type Props = {
  tabs: any[];
  activeTabKey: string;
  onHeaderActionChange?: (node: React.ReactNode | null) => void;
  visible?: boolean;
};

function getActiveAssetIdFromTabs(
  tabs: any[],
  activeTabKey: string,
): string | null {
  const tab = tabs?.find((t) => (t?.key ?? t?.id) === activeTabKey) ?? null;
  return (tab?.assetId ?? tab?.asset_id ?? tab?.assetID ?? null) as
    | string
    | null;
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function readLayoutMode(): LayoutMode {
  const v = window.localStorage.getItem("choraleia:fileManager:layout");
  if (v === "horizontal" || v === "vertical") return v;
  return "vertical";
}

function readSplitRatio(): number {
  const v = Number(window.localStorage.getItem("choraleia:fileManager:split"));
  if (Number.isFinite(v)) return clamp(v, 10, 90);
  return 50;
}

function readPaneOrder(): PaneOrder {
  const v = window.localStorage.getItem("choraleia:fileManager:paneOrder");
  if (v === "remote-first" || v === "local-first") return v;
  return "remote-first";
}

function readColumns(): EntryColumn[] {
  const raw = window.localStorage.getItem("choraleia:fileManager:columns");
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) {
        const allowed: EntryColumn[] = ["mode", "size", "mtime", "name"];
        const cols = parsed.filter((x): x is EntryColumn =>
          typeof x === "string" && (allowed as string[]).includes(x),
        );
        if (cols.length) return cols;
      }
    } catch {
      // ignore
    }
  }
  // Default: mimic `ls -l` (without owner/group/links which we don't have).
  return ["name", "mode", "size", "mtime"];
}

function readShowHidden(): boolean {
  return window.localStorage.getItem("choraleia:fileManager:showHidden") === "true";
}

function normalizePosixPath(p: string): string {
  if (!p) return "/";
  // Always use forward slashes.
  let out = p.replace(/\\/g, "/");
  // Collapse duplicate slashes (global).
  out = out.replace(/\/+/g, "/");
  // Ensure leading slash.
  if (!out.startsWith("/")) out = "/" + out;
  // Remove trailing slash (except root).
  if (out.length > 1 && out.endsWith("/")) out = out.slice(0, -1);
  return out;
}

// Root-only UI: show a single "/". For non-root paths, render a single leading
// slash glyph and then render clickable segments.
function splitPathSegments(p: string): Array<{ label: string; path: string }> {
  const norm = normalizePosixPath(p);
  if (norm === "/") {
    return [{ label: "/", path: "/" }];
  }

  const parts = norm.split("/").filter(Boolean);

  const segs: Array<{ label: string; path: string }> = [];
  let acc = "";
  for (const part of parts) {
    acc += "/" + part;
    segs.push({ label: part, path: acc });
  }
  return segs;
}

type TransferDirection = "remote-to-local" | "local-to-remote";

type FileRowProps = {
  pane: PaneId;
  entries: Array<FSEntry>;
  selection: Set<string>;
  dragOverDirPath: string | null;
  assetId: string | null;
  containerId: string | null;
  hasRemoteFS: boolean;
  localPath: string;
  remotePath: string;
  entryGridTemplateColumns: string;
  columns: EntryColumn[];
  formatSize: (bytes: number) => string;
  formatMTime: (iso: string) => string;
  openEntry: (pane: PaneId, ent: any) => void;
  updateSelectionByClick: (opts: {
    pane: PaneId;
    entries: Array<FSEntry>;
    clickedPath: string;
    ctrlOrMeta: boolean;
    shift: boolean;
  }) => void;
  setPaneSelection: (pane: PaneId, next: Set<string>) => void;
  setPaneAnchor: (pane: PaneId, v: string | null) => void;
  setCtxMenu: React.Dispatch<
    React.SetStateAction<
      | null
      | {
          mouseX: number;
          mouseY: number;
          pane: PaneId;
        }
    >
  >;
};

type VirtualFileRowInnerProps = {
  index: number;
  style: React.CSSProperties;
  row: FileRowProps;
};

type FileListHeaderProps = {
  columns: EntryColumn[];
  gridTemplateColumns: string;
  widths: ColumnWidths;
  sortKey: SortKey;
  sortDir: SortDir;
  onSort: (key: SortKey) => void;
  onResizeStart: (col: EntryColumn, startX: number, startWidth: number) => void;
};

function FileListHeaderRow(props: FileListHeaderProps): React.ReactElement {
  const { columns, gridTemplateColumns, widths, sortKey, sortDir, onSort, onResizeStart } = props;

  const labelFor = (c: EntryColumn): string => {
    if (c === "name") return "Name";
    if (c === "mode") return "Mode";
    if (c === "size") return "Size";
    if (c === "mtime") return "Modified";
    return c;
  };

  const isSortable = (c: EntryColumn): c is SortKey => c === "name" || c === "size" || c === "mtime";

  const sortIcon = (c: EntryColumn) => {
    if (!isSortable(c)) return null;
    if (sortKey !== c) return null;
    return sortDir === "asc" ? (
      <ArrowDropUpIcon sx={{ fontSize: 16, opacity: 0.8 }} />
    ) : (
      <ArrowDropDownIcon sx={{ fontSize: 16, opacity: 0.8 }} />
    );
  };

  const visibleColumns = COLUMN_ORDER.filter((c) => columns.includes(c));
  const visibleColsForHandles = visibleColumns.slice(0, -1);

  // Hover zone: when the pointer is near a column boundary, switch cursor to col-resize.
  // We intentionally do NOT show a line; the hovered column background provides a natural boundary.
  const [isNearBoundary, setIsNearBoundary] = React.useState<boolean>(false);
  const [hoveredHeaderCol, setHoveredHeaderCol] = React.useState<EntryColumn | null>(null);

  const boundaryLefts = React.useMemo(() => {
    const lefts: number[] = [];
    let acc = 0;
    for (const c of visibleColsForHandles) {
      const { min, max, default: def } = getColumnConstraints(c);
      const w = clampInt(widths[c] ?? def, min, max);
      acc += w;
      lefts.push(acc);
    }
    return lefts;
  }, [visibleColsForHandles, widths]);

  const HOVER_ZONE_PX = 8;

  const updateBoundaryProximity = React.useCallback(
    (clientX: number, targetEl: HTMLElement) => {
      const rect = targetEl.getBoundingClientRect();
      const x = clientX - rect.left;
      let near = false;
      for (const left of boundaryLefts) {
        if (Math.abs(x - left) <= HOVER_ZONE_PX) {
          near = true;
          break;
        }
      }
      setIsNearBoundary(near);
    },
    [boundaryLefts],
  );

  return (
    <Box
      sx={(theme) => ({
        flexShrink: 0,
        py: 0.25,
        height: 26,
        display: "flex",
        alignItems: "center",
      })}
    >
      {/* Empty icon slot to align with row icons */}
      <Box sx={{ width: 24, flexShrink: 0 }} />

      <Box
        onMouseMove={(e) =>
          updateBoundaryProximity(
            e.clientX,
            e.currentTarget as unknown as HTMLElement,
          )
        }
        onMouseLeave={() => {
          setIsNearBoundary(false);
          setHoveredHeaderCol(null);
        }}
        sx={{
          width: "100%",
          minWidth: 0,
          overflow: "hidden",
          position: "relative",
          cursor: isNearBoundary ? "col-resize" : "default",
        }}
      >
        <Box
          sx={{
            display: "grid",
            gridTemplateColumns,
            alignItems: "center",
            width: "fit-content",
            minWidth: "100%",
            // Must match the row grid gap exactly.
            gap: 1,
            position: "relative",
            justifyItems: "start",
            // Single shared padding for header + rows to ensure the same x-origin.
            pl: 0.75,
          }}
        >
          {visibleColumns.map((c) => (
            <Box
              key={c}
              onMouseEnter={() => setHoveredHeaderCol(c)}
              sx={(theme) => ({
                position: "relative",
                minWidth: 0,
                display: "flex",
                alignItems: "center",
                justifyContent: "flex-start",
                // Keep header/row alignment stable by using the same inner padding strategy.
                borderRadius: 0.75,
                backgroundColor:
                  hoveredHeaderCol === c
                    ? theme.palette.action.hover
                    : "transparent",
              })}
            >
              <Box
                role={isSortable(c) ? "button" : undefined}
                onClick={
                  isSortable(c)
                    ? () => {
                        onSort(c);
                      }
                    : undefined
                }
                sx={(theme) => ({
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 0.25,
                  minWidth: 0,
                  cursor: isSortable(c) ? "pointer" : "default",
                  color: theme.palette.text.secondary,
                  userSelect: "none",
                })}
              >
                <Typography variant="caption" noWrap sx={{ fontSize: 11, fontWeight: 600 }}>
                  {labelFor(c)}
                </Typography>
                {sortIcon(c)}
              </Box>
            </Box>
          ))}

          {/* Overlay resize handles on top of the right edge of each visible column (except last). */}
          {visibleColsForHandles.map((c, idx) => {
            const currentWidth = widths[c] ?? getColumnConstraints(c).default;
            // Compute right edge of column idx in pixels based on fixed column widths.
            let left = 0;
            for (let i = 0; i <= idx; i++) {
              const col = visibleColumns[i];
              const { min, max, default: def } = getColumnConstraints(col);
              const w = clampInt(widths[col] ?? def, min, max);
              left += w;
            }

            return (
              <Box
                key={`${c}:resizer`}
                onPointerDown={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onResizeStart(c, e.clientX, currentWidth);
                }}
                sx={{
                  position: "absolute",
                  top: 0,
                  left,
                  height: "100%",
                  // Keep the hit area wide for usability.
                  width: 10,
                  // Center the handle on the boundary.
                  transform: "translateX(-5px)",
                  cursor: "col-resize",
                  touchAction: "none",
                  zIndex: 5,
                  backgroundColor: "transparent",
                }}
              />
            );
          })}
        </Box>
      </Box>
    </Box>
  );
}

const DND_MIME = "application/x-choraleia-fm-selection";
const DND_TEXT_PREFIX = "choraleia-fm-selection:";

type FMDragPayload = {
  fromPane: PaneId;
  paths: string[];
};

function serializeDragPayload(payload: FMDragPayload): string {
  return JSON.stringify(payload);
}

function serializeDragPayloadText(payload: FMDragPayload): string {
  return `${DND_TEXT_PREFIX}${serializeDragPayload(payload)}`;
}

function parseDragPayload(raw: string | null): FMDragPayload | null {
  if (!raw) return null;
  if (raw.startsWith(DND_TEXT_PREFIX)) {
    return parseDragPayload(raw.slice(DND_TEXT_PREFIX.length));
  }
  try {
    const parsed = JSON.parse(raw) as any;
    if (!parsed || (parsed.fromPane !== "local" && parsed.fromPane !== "remote")) return null;
    if (!Array.isArray(parsed.paths)) return null;
    const paths = parsed.paths.filter((p: any) => typeof p === "string" && p.length > 0);
    if (!paths.length) return null;
    return { fromPane: parsed.fromPane, paths };
  } catch {
    return null;
  }
}

function getDragPayloadFromEvent(e: React.DragEvent): FMDragPayload | null {
  // WebViews may not expose custom MIME types during dragover.
  // Read the payload on drop using both the custom type and a text/plain fallback.
  try {
    const fromMime = e.dataTransfer.getData(DND_MIME);
    const parsed = parseDragPayload(fromMime);
    if (parsed) return parsed;
  } catch {
    // ignore
  }

  try {
    const fromText = e.dataTransfer.getData("text/plain");
    return parseDragPayload(fromText);
  } catch {
    return null;
  }
}

function hasDragPayloadType(e: React.DragEvent): boolean {
  try {
    const types = Array.from(e.dataTransfer.types || []);
    return types.includes(DND_MIME) || types.includes("text/plain");
  } catch {
    return false;
  }
}

const VirtualFileRowInner = React.memo(function VirtualFileRowInner(
  props: VirtualFileRowInnerProps,
) {
  const { index, style, row } = props;
  const {
    pane,
    entries,
    selection,
    dragOverDirPath,
    localPath,
    remotePath,
    entryGridTemplateColumns,
    columns,
    formatSize,
    formatMTime,
    openEntry,
    updateSelectionByClick,
    setPaneSelection,
    setPaneAnchor,
    setCtxMenu,
  } = row;

  const ent: any = (entries as any[])[index];
  const isSelected = selection.has(ent.path);
  const isDropDirTarget =
    Boolean(dragOverDirPath) &&
    Boolean(ent?.is_dir) &&
    String(ent?.path || "") === String(dragOverDirPath);

  return (
    <div style={style}>
      <ListItemButton
        dense
        selected={isSelected}
        sx={(theme) => ({
          cursor: "default",
          py: 0.25,
          minHeight: 30,
          ...(isDropDirTarget
            ? {
                outline: `1px dashed ${theme.palette.primary.main}`,
                outlineOffset: -1,
                backgroundColor:
                  theme.palette.mode === "light"
                    ? "rgba(25,118,210,0.12)"
                    : "rgba(144,202,249,0.14)",
              }
            : null),
        })}
        draggable
        data-fm-dir-path={ent?.is_dir ? String(ent?.path || "") : undefined}
        onDragStart={(e) => {
          // Ensure something is selected.
          let paths = Array.from(selection);
          if (!paths.length) {
            paths = [ent.path];
            setPaneSelection(pane, new Set(paths));
            setPaneAnchor(pane, ent.path);
          }

          const payload: FMDragPayload = { fromPane: pane, paths };
          try {
            e.dataTransfer.setData(DND_MIME, serializeDragPayload(payload));
            // Fallback for WebViews / environments that don't preserve custom MIME.
            e.dataTransfer.setData("text/plain", serializeDragPayloadText(payload));
            e.dataTransfer.effectAllowed = "copy";
          } catch {
            // ignore
          }
        }}
        // Drop handling is managed at the pane level for reliability with virtualization.
        onClick={(e) => {
          updateSelectionByClick({
            pane,
            entries,
            clickedPath: ent.path,
            ctrlOrMeta:
              (e as unknown as React.MouseEvent).metaKey ||
              (e as unknown as React.MouseEvent).ctrlKey,
            shift: (e as unknown as React.MouseEvent).shiftKey,
          });
        }}
        onDoubleClick={() => openEntry(pane, ent)}
        onContextMenu={(e) => {
          e.preventDefault();

          // If right-clicking an unselected row, select it first.
          if (!selection.has(ent.path)) {
            setPaneSelection(pane, new Set([ent.path]));
            setPaneAnchor(pane, ent.path);
          }

          // Always open the context menu at the current pointer location.
          setCtxMenu({
            mouseX: e.clientX + 2,
            mouseY: e.clientY - 6,
            pane,
          });
        }}
      >
        <ListItemIcon sx={{ minWidth: 24 }}>
          {ent.is_dir ? (
            <FolderIcon fontSize="small" />
          ) : (
            <InsertDriveFileIcon fontSize="small" />
          )}
        </ListItemIcon>

        <Box
          sx={{
            display: "grid",
            gridTemplateColumns: entryGridTemplateColumns,
            // Must match header grid gap exactly.
            gap: 1,
            alignItems: "center",
            width: "100%",
            minWidth: 0,
            justifyItems: "stretch",
            // Single shared padding for header + rows to ensure the same x-origin.
            pl: 0.75,
          }}
        >
          {columns.includes("name") && (
            <Box sx={{ minWidth: 0 }}>
              <Typography variant="body2" noWrap sx={{ minWidth: 0 }}>
                {ent.name}
              </Typography>
            </Box>
          )}
          {columns.includes("mode") && (
            <Box sx={{ minWidth: 0 }}>
              <Typography variant="caption" color="text.secondary" noWrap>
                {ent.mode || ""}
              </Typography>
            </Box>
          )}
          {columns.includes("size") && (
            <Box sx={{ minWidth: 0 }}>
              <Typography
                variant="caption"
                color="text.secondary"
                noWrap
                sx={{ textAlign: "right" }}
              >
                {typeof ent.size === "number" ? formatSize(ent.size) : ""}
              </Typography>
            </Box>
          )}
          {columns.includes("mtime") && (
            <Box sx={{ minWidth: 0 }}>
              <Typography variant="caption" color="text.secondary" noWrap>
                {ent.mod_time ? formatMTime(ent.mod_time) : ""}
              </Typography>
            </Box>
          )}
        </Box>
      </ListItemButton>
    </div>
  );
});

// react-window expects a plain function here (not an ExoticComponent from React.memo).
function VirtualFileRow(props: RowComponentProps<FileRowProps>): React.ReactElement {
  const { index, style, ...rest } = props as unknown as {
    index: number;
    style: React.CSSProperties;
  } & FileRowProps;
  return <VirtualFileRowInner index={index} style={style} row={rest} />;
}

const dividerCommonSx = {
  bgcolor: "transparent",
  flexShrink: 0,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  userSelect: "none" as const,
} as const;

// Ensure react-window's inner container shrinks to content width (like the header grid)
// while still being at least as wide as the viewport. This prevents subtle horizontal
// sizing drift between the header and the virtualized rows during pane resizing.
export default function FileManagerPanel(props: Props) {
  const { tabs, activeTabKey, onHeaderActionChange, visible = true } = props;

  const assetId = useMemo(
    () => getActiveAssetIdFromTabs(tabs, activeTabKey),
    [tabs, activeTabKey],
  );

  // Best-effort: infer from tab metadata while the asset is still loading.
  const tabHintType = useMemo(() => {
    const tab = tabs?.find((t) => (t?.key ?? t?.id) === activeTabKey) ?? null;
    return (
      tab?.meta?.assetType ??
      tab?.type ??
      tab?.assetType ??
      tab?.asset_type ??
      null
    ) as string | null;
  }, [tabs, activeTabKey]);

  // Get containerId for Docker container terminals
  const containerId = useMemo(() => {
    const tab = tabs?.find((t) => (t?.key ?? t?.id) === activeTabKey) ?? null;
    return (tab?.meta?.containerId ?? null) as string | null;
  }, [tabs, activeTabKey]);

  const [showHidden, setShowHidden] = useState<boolean>(() => readShowHidden());

  const [remotePath, setRemotePath] = useState<string>("");
  const [localPath, setLocalPath] = useState<string>("/");

  const [remotePathInput, setRemotePathInput] = useState<string>("");
  const [localPathInput, setLocalPathInput] = useState<string>("/");

  const [asset, setAsset] = useState<Asset | null>(null);

  // Use TanStack Query for file listings (auto-refreshes on fs events)
  const {
    data: localData,
    isLoading: localLoading,
    error: localQueryError,
    refetch: refetchLocal,
  } = useFileManagerList({
    path: localPath || "/",
    showHidden,
    enabled: true,
  });

  const {
    data: remoteData,
    isLoading: remoteLoading,
    error: remoteQueryError,
    refetch: refetchRemote,
  } = useFileManagerList({
    assetId,
    containerId,
    path: remotePath || undefined,
    showHidden,
    enabled: !!assetId,
  });

  // Derived state from query results
  const localEntries = localData?.entries ?? [];
  const remoteEntries = remoteData?.entries ?? [];
  const localError = localQueryError ? (localQueryError instanceof Error ? localQueryError.message : String(localQueryError)) : null;
  const remoteError = remoteQueryError ? (remoteQueryError instanceof Error ? remoteQueryError.message : String(remoteQueryError)) : null;

  // Sync path inputs with actual paths from server response
  useEffect(() => {
    if (localData?.path) {
      setLocalPath(localData.path);
      setLocalPathInput(localData.path);
    }
  }, [localData?.path]);

  useEffect(() => {
    if (remoteData?.path) {
      setRemotePath(remoteData.path);
      setRemotePathInput(remoteData.path);
    }
  }, [remoteData?.path]);

  // Manual refresh functions (for toolbar buttons)
  const refreshLocal = useCallback(() => {
    void refetchLocal();
  }, [refetchLocal]);

  const refreshRemote = useCallback(() => {
    void refetchRemote();
  }, [refetchRemote]);


  // Asset type can be momentarily unknown while loading; avoid hiding the remote pane during that window.
  const hasAssetLoaded = assetId ? asset !== null : true;
  const isSSHAsset =
    asset?.type === "ssh" || (!hasAssetLoaded && tabHintType === "ssh");
  const isDockerAsset =
    asset?.type === "docker_host" ||
    tabHintType === "docker_host" ||
    tabHintType === "docker_container" ||
    !!containerId;

  // Unified flag for whether this asset supports remote file system
  const hasRemoteFS = isSSHAsset || isDockerAsset;


  const [layout, setLayout] = useState<LayoutMode>(() => readLayoutMode());
  const [split, setSplit] = useState<number>(() => readSplitRatio());

  const [paneOrder, setPaneOrder] = useState<PaneOrder>(() => readPaneOrder());

  const [columns, setColumns] = useState<EntryColumn[]>(() => readColumns());

  const [sortKey, setSortKey] = useState<SortKey>(() => readSortState().key);
  const [sortDir, setSortDir] = useState<SortDir>(() => readSortState().dir);

  const [colWidths, setColWidths] = useState<ColumnWidths>(() => readColumnWidths());


  // Horizontal scrolling is now handled by a shared scroll container per pane,
  // so the header and rows stay perfectly synchronized without React-driven transforms.

  // Used by the virtual list to measure the viewport height.
  const localListViewportRef = useRef<HTMLDivElement | null>(null);
  const remoteListViewportRef = useRef<HTMLDivElement | null>(null);
  const [localListHeight, setLocalListHeight] = useState<number>(360);
  const [remoteListHeight, setRemoteListHeight] = useState<number>(360);

  useEffect(() => {
    const el = localListViewportRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      setLocalListHeight(el.clientHeight || 360);
    });
    ro.observe(el);
    setLocalListHeight(el.clientHeight || 360);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const el = remoteListViewportRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      setRemoteListHeight(el.clientHeight || 360);
    });
    ro.observe(el);
    setRemoteListHeight(el.clientHeight || 360);
    return () => ro.disconnect();
  }, []);

  const toggleLayout = useCallback(() => {
    setLayout((prev) => (prev === "horizontal" ? "vertical" : "horizontal"));
  }, []);

  const togglePaneOrder = useCallback(() => {
    setPaneOrder((prev) =>
      prev === "remote-first" ? "local-first" : "remote-first",
    );
  }, []);

  // Used to align the breadcrumb overlay so the label spacing is consistent.
  const localAdornmentRef = useRef<HTMLDivElement | null>(null);
  const remoteAdornmentRef = useRef<HTMLDivElement | null>(null);

  const splitContainerRef = useRef<HTMLDivElement | null>(null);
  const isDraggingRef = useRef<boolean>(false);
  const splitRafRef = useRef<number | null>(null);
  const splitPendingRef = useRef<number | null>(null);


  const [activePathEditPane, setActivePathEditPane] = useState<PaneId | null>(
    null,
  );

  const localInputRef = useRef<HTMLInputElement | null>(null);
  const remoteInputRef = useRef<HTMLInputElement | null>(null);

  const localCrumbScrollerRef = useRef<HTMLDivElement | null>(null);
  const remoteCrumbScrollerRef = useRef<HTMLDivElement | null>(null);

  const startEdit = useCallback(
    (pane: PaneId) => {
      setActivePathEditPane(pane);
      // Focus on next frame so the input is mounted.
      requestAnimationFrame(() => {
        const el =
          pane === "local" ? localInputRef.current : remoteInputRef.current;
        if (el) {
          el.focus();
          el.select();
        }
      });
    },
    [],
  );

  const cancelEdit = useCallback(
    (pane: PaneId) => {
      if (pane === "local") setLocalPathInput(localPath);
      else setRemotePathInput(remotePath);
      setActivePathEditPane(null);
    },
    [localPath, remotePath],
  );

  // Navigation just updates the path - TanStack Query handles the fetch automatically
  const navigateLocal = useCallback(
    (nextPath: string) => {
      const p = normalizePosixPath(nextPath);
      setLocalPath(p);
      setLocalPathInput(p);
    },
    [],
  );

  const navigateRemote = useCallback(
    (nextPath: string) => {
      if (!assetId) return;
      const p = normalizePosixPath(nextPath);
      setRemotePath(p);
      setRemotePathInput(p);
    },
    [assetId],
  );

  const commitEdit = useCallback(
    (pane: PaneId) => {
      setActivePathEditPane(null);
      if (pane === "local") {
        navigateLocal(localPathInput);
      } else {
        navigateRemote(remotePathInput);
      }
    },
    [navigateLocal, navigateRemote, localPathInput, remotePathInput],
  );

  // Load asset details so we can verify whether SFTP is supported.
  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!assetId) {
        setAsset(null);
        return;
      }
      try {
        const a = await getAsset(assetId);
        if (!cancelled) setAsset(a);
      } catch {
        if (!cancelled) setAsset(null);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [assetId]);

  useEffect(() => {
    window.localStorage.setItem("choraleia:fileManager:layout", layout);
  }, [layout]);

  useEffect(() => {
    window.localStorage.setItem("choraleia:fileManager:split", String(split));
  }, [split]);

  useEffect(() => {
    window.localStorage.setItem("choraleia:fileManager:paneOrder", paneOrder);
  }, [paneOrder]);

  useEffect(() => {
    window.localStorage.setItem("choraleia:fileManager:columns", JSON.stringify(columns));
  }, [columns]);

  useEffect(() => {
    window.localStorage.setItem("choraleia:fileManager:showHidden", showHidden ? "true" : "false");
  }, [showHidden]);

  // Keep adornment measurements updated.
  // (No longer needed; label and breadcrumbs are rendered in a single overlay row.)

  const startDrag = useCallback(
    (e: React.MouseEvent) => {
      isDraggingRef.current = true;
      document.body.style.userSelect = "none";
      document.body.style.cursor = layout === "horizontal" ? "col-resize" : "row-resize";
      e.preventDefault();
    },
    [layout],
  );

  const stopDrag = useCallback(() => {
    isDraggingRef.current = false;
    document.body.style.userSelect = "";
    document.body.style.cursor = "";
  }, []);

  useEffect(() => {
    function onMove(e: MouseEvent) {
      if (!isDraggingRef.current) return;
      if (!splitContainerRef.current) return;

      const rect = splitContainerRef.current.getBoundingClientRect();

      let nextRatio: number;
      if (layout === "horizontal") {
        const x = e.clientX - rect.left;
        nextRatio = clamp((x / rect.width) * 100, 10, 90);
      } else {
        const y = e.clientY - rect.top;
        nextRatio = clamp((y / rect.height) * 100, 10, 90);
      }

      // Throttle to one React state update per animation frame.
      // Also ignore tiny changes to reduce re-render churn.
      if (Math.abs(nextRatio - split) < 0.15) {
        e.preventDefault();
        return;
      }
      splitPendingRef.current = nextRatio;
      if (splitRafRef.current === null) {
        splitRafRef.current = window.requestAnimationFrame(() => {
          splitRafRef.current = null;
          const pending = splitPendingRef.current;
          if (typeof pending === "number") {
            setSplit((prev) => (Math.abs(pending - prev) < 0.15 ? prev : pending));
          }
        });
      }

      e.preventDefault();
    }

    window.addEventListener("mousemove", onMove, { passive: false });
    window.addEventListener("mouseup", stopDrag);

    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", stopDrag);

      if (splitRafRef.current !== null) {
        window.cancelAnimationFrame(splitRafRef.current);
        splitRafRef.current = null;
      }
      splitPendingRef.current = null;
    };
  }, [layout, stopDrag, split]);


  const [selectedLocal, setSelectedLocal] = useState<Set<string>>(() => new Set());
  const [selectedRemote, setSelectedRemote] = useState<Set<string>>(() => new Set());
  const [anchorLocal, setAnchorLocal] = useState<string | null>(null);
  const [anchorRemote, setAnchorRemote] = useState<string | null>(null);

  const [ctxMenu, setCtxMenu] = useState<
    | null
    | {
        mouseX: number;
        mouseY: number;
        pane: PaneId;
      }
  >(null);

  const [transferBusy, setTransferBusy] = useState<boolean>(false);
  const [transferError, setTransferError] = useState<string | null>(null);
  const [transferProgress] = useState<
    | null
    | {
        total: number;
        done: number;
        current?: string;
        direction: TransferDirection;
      }
  >(null);

  // Rename UI is currently disabled.
  const [renameDialog] = useState<null>(null);

  const closeCtxMenu = useCallback(() => setCtxMenu(null), []);

  const getPaneSelection = useCallback(
    (pane: PaneId) => (pane === "local" ? selectedLocal : selectedRemote),
    [selectedLocal, selectedRemote],
  );

  const setPaneSelection = useCallback(
    (pane: PaneId, next: Set<string>) => {
      if (pane === "local") setSelectedLocal(next);
      else setSelectedRemote(next);
    },
    [],
  );

  const getPaneAnchor = useCallback(
    (pane: PaneId) => (pane === "local" ? anchorLocal : anchorRemote),
    [anchorLocal, anchorRemote],
  );

  const setPaneAnchor = useCallback(
    (pane: PaneId, v: string | null) => {
      if (pane === "local") setAnchorLocal(v);
      else setAnchorRemote(v);
    },
    [],
  );

  // (helpers moved earlier)

  const clearSelection = useCallback(
    (pane: PaneId) => {
      setPaneSelection(pane, new Set());
      setPaneAnchor(pane, null);
    },
    [setPaneAnchor, setPaneSelection],
  );

  const updateSelectionByClick = useCallback(
    (opts: {
      pane: PaneId;
      entries: Array<FSEntry>;
      clickedPath: string;
      ctrlOrMeta: boolean;
      shift: boolean;
    }) => {
      const { pane, entries, clickedPath, ctrlOrMeta, shift } = opts;
      const current = getPaneSelection(pane);
      const next = new Set<string>(current);
      const anchor = getPaneAnchor(pane);
      const allPaths = entries.map((e: any) => e.path);

      if (shift && anchor && allPaths.includes(anchor) && allPaths.includes(clickedPath)) {
        const a = allPaths.indexOf(anchor);
        const b = allPaths.indexOf(clickedPath);
        const [start, end] = a < b ? [a, b] : [b, a];
        const range = allPaths.slice(start, end + 1);
        const base = ctrlOrMeta ? next : new Set<string>();
        for (const p of range) base.add(p);
        setPaneSelection(pane, base);
        return;
      }

      if (ctrlOrMeta) {
        if (next.has(clickedPath)) next.delete(clickedPath);
        else next.add(clickedPath);
        setPaneSelection(pane, next);
        setPaneAnchor(pane, clickedPath);
        return;
      }

      setPaneSelection(pane, new Set([clickedPath]));
      setPaneAnchor(pane, clickedPath);
    },
    [getPaneAnchor, getPaneSelection, setPaneAnchor, setPaneSelection],
  );

  const openEntry = useCallback(
    (pane: PaneId, ent: any) => {
      if (ent?.is_dir) {
        if (pane === "local") void navigateLocal(ent.path);
        else void navigateRemote(ent.path);
      }
    },
    [navigateLocal, navigateRemote],
  );

  const formatSize = useCallback((bytes: number): string => {
    if (!Number.isFinite(bytes)) return "";
    if (bytes < 1024) return String(bytes);
    const units = ["K", "M", "G", "T"];
    let v = bytes;
    let i = -1;
    while (v >= 1024 && i < units.length - 1) {
      v /= 1024;
      i++;
    }
    const fixed = v >= 10 || i === 0 ? v.toFixed(0) : v.toFixed(1);
    return `${fixed}${units[i]}`;
  }, []);

  const formatMTime = useCallback((iso: string): string => {
    if (!iso) return "";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }, []);

  const [dragOverPane, setDragOverPane] = useState<PaneId | null>(null);
  const [dragOverDir, setDragOverDir] = useState<
    null | { pane: PaneId; path: string }
  >(null);

  const resolveDropTargetDir = useCallback(
    (pane: PaneId, e: React.DragEvent): string => {
      const t = e.target as HTMLElement | null;
      const row = t ? (t.closest("[data-fm-dir-path]") as HTMLElement | null) : null;
      const dirPath = row?.getAttribute("data-fm-dir-path") || "";
      if (dirPath) return normalizePosixPath(dirPath);
      return pane === "local" ? localPath : (remotePath || "/");
    },
    [localPath, remotePath],
  );

  const computeDragOverState = useCallback(
    (pane: PaneId, e: React.DragEvent) => {
      const t = e.target as HTMLElement | null;
      const dirEl = t
        ? (t.closest("[data-fm-dir-path]") as HTMLElement | null)
        : null;
      const dirPath = dirEl?.getAttribute("data-fm-dir-path") || "";

      if (dirPath) {
        // Hovering a directory row => highlight only that directory row.
        setDragOverDir({ pane, path: normalizePosixPath(dirPath) });
        setDragOverPane(null);
        return;
      }

      // Hovering empty area or a file row => highlight the whole pane.
      setDragOverDir(null);
      setDragOverPane(pane);
    },
    [],
  );

  const handlePaneDragOver = useCallback(
    (pane: PaneId, e: React.DragEvent) => {
      if (!hasDragPayloadType(e)) return;
      // We only allow cross-pane drops.
      // In some WebViews, getData() is empty during dragover, so we can't validate further.
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
      computeDragOverState(pane, e);
    },
    [computeDragOverState],
  );

  const handlePaneDragLeave = useCallback((pane: PaneId) => {
    setDragOverPane((prev) => (prev === pane ? null : prev));
    setDragOverDir((prev) => (prev?.pane === pane ? null : prev));
  }, []);

  const handlePaneDrop = useCallback(
    async (pane: PaneId, e: React.DragEvent) => {
      const payload = getDragPayloadFromEvent(e);
      if (!payload) return;
      if (payload.fromPane === pane) return;

      e.preventDefault();
      e.stopPropagation();
      setDragOverPane(null);
      setDragOverDir(null);

      if (!hasRemoteFS || !assetId) return;

      const direction: TransferDirection =
        payload.fromPane === "remote" ? "remote-to-local" : "local-to-remote";

      const dstDir = resolveDropTargetDir(pane, e);

      const srcEntries = (payload.fromPane === "local" ? localEntries : remoteEntries) as any[];
      const byPath = new Map<string, any>(srcEntries.map((x) => [x.path, x]));

      // Check if any dragged item is a directory (for recursive flag)
      const hasDir = payload.paths.some((p: string) => byPath.get(p)?.is_dir);

      // Single request with all dragged paths
      const req: TransferRequest =
        direction === "remote-to-local"
          ? {
              from: { asset_id: assetId, container_id: containerId || undefined, paths: payload.paths },
              to: { path: dstDir },
              recursive: hasDir,
              overwrite: true,
            }
          : {
              from: { paths: payload.paths },
              to: { asset_id: assetId, container_id: containerId || undefined, path: dstDir },
              recursive: hasDir,
              overwrite: true,
            };
      await tasksEnqueueTransfer(req);
    },
    [
      assetId,
      containerId,
      hasRemoteFS,
      localEntries,
      remoteEntries,
      resolveDropTargetDir,
    ],
  );

  const selectedCount = selectedLocal.size + selectedRemote.size;

  const handleDeleteSelection = useCallback(
    async (pane: PaneId) => {
      const sel = Array.from(getPaneSelection(pane));
      if (sel.length === 0) return;

      const ok = window.confirm(`Delete ${sel.length} item(s)?`);
      if (!ok) return;

      setTransferBusy(true);
      setTransferError(null);
      try {
        if (pane === "local") {
          for (const p of sel) {
            await (await import("../../api/fs")).fsRemove({
              path: String(p),
            });
          }
          await refreshLocal();
        } else {
          if (!assetId) return;
          for (const p of sel) {
            await (await import("../../api/fs")).fsRemove({
              assetId,
              containerId: containerId || undefined,
              path: String(p),
            });
          }
          await refreshRemote();
        }
        clearSelection(pane);
      } catch (e) {
        setTransferError(e instanceof Error ? e.message : String(e));
      } finally {
        setTransferBusy(false);
      }
    },
    [assetId, containerId, clearSelection, getPaneSelection, refreshLocal, refreshRemote],
  );

  const enqueueTransferTask = useCallback(
    async (direction: TransferDirection) => {
      if (!hasRemoteFS || !assetId) return;

      const fromPane: PaneId = direction === "local-to-remote" ? "local" : "remote";
      const toPane: PaneId = fromPane === "local" ? "remote" : "local";

      const selection = Array.from(getPaneSelection(fromPane));
      if (selection.length === 0) return;

      const dstDir = toPane === "local" ? localPath : (remotePath || "/");

      const srcEntries = (fromPane === "local" ? localEntries : remoteEntries) as any[];
      const byPath = new Map<string, any>(srcEntries.map((x) => [String(x.path), x]));

      // Check if any selected item is a directory (for recursive flag)
      const hasDir = selection.some((p) => byPath.get(String(p))?.is_dir);

      setTransferBusy(true);
      setTransferError(null);
      try {
        // Single request with all selected paths
        const req: TransferRequest =
          direction === "remote-to-local"
            ? {
                from: { asset_id: assetId, container_id: containerId || undefined, paths: selection.map(String) },
                to: { path: dstDir },
                recursive: hasDir,
                overwrite: true,
              }
            : {
                from: { paths: selection.map(String) },
                to: { asset_id: assetId, container_id: containerId || undefined, path: dstDir },
                recursive: hasDir,
                overwrite: true,
              };

        await tasksEnqueueTransfer(req);
        // Note: File list will refresh automatically when task.completed event is received
      } catch (e) {
        setTransferError(e instanceof Error ? e.message : String(e));
      } finally {
        setTransferBusy(false);
      }
    },
    [
      assetId,
      containerId,
      getPaneSelection,
      hasRemoteFS,
      localEntries,
      localPath,
      remoteEntries,
      remotePath,
    ],
  );

  // Precompute the grid columns template once per render.
  const entryGridTemplateColumns = useMemo(() => {
    const cols = columns;
    const parts: string[] = [];
    for (const c of COLUMN_ORDER) {
      if (!cols.includes(c)) continue;
      const { min, max, default: def } = getColumnConstraints(c);
      const w = clampInt(colWidths[c] ?? def, min, max);
      // Name is resizable but should still be able to grow if space exists.
      if (c === "name") parts.push(`minmax(${min}px, ${w}px)`);
      else parts.push(`${w}px`);
    }
    return parts.join(" ");
  }, [columns, colWidths]);

  const sortedLocalEntries = useMemo(() => {
    const arr = [...(localEntries || [])];
    const dirFirst = (a: any, b: any) => {
      const ad = !!a?.is_dir;
      const bd = !!b?.is_dir;
      if (ad !== bd) return ad ? -1 : 1;
      return 0;
    };
    const getMTime = (x: any): number => {
      const t = Date.parse(String(x?.mod_time || ""));
      return Number.isFinite(t) ? t : 0;
    };

    arr.sort((a: any, b: any) => {
      const d = dirFirst(a, b);
      if (d !== 0) return d;

      let cmp = 0;
      if (sortKey === "name") {
        cmp = String(a?.name || "").localeCompare(String(b?.name || ""));
      } else if (sortKey === "size") {
        cmp = (Number(a?.size || 0) || 0) - (Number(b?.size || 0) || 0);
      } else if (sortKey === "mtime") {
        cmp = getMTime(a) - getMTime(b);
      }

      if (cmp === 0) {
        cmp = String(a?.name || "").localeCompare(String(b?.name || ""));
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
    return arr;
  }, [localEntries, sortKey, sortDir]);

  const sortedRemoteEntries = useMemo(() => {
    const arr = [...(remoteEntries || [])];
    const dirFirst = (a: any, b: any) => {
      const ad = !!a?.is_dir;
      const bd = !!b?.is_dir;
      if (ad !== bd) return ad ? -1 : 1;
      return 0;
    };
    const getMTime = (x: any): number => {
      const t = Date.parse(String(x?.mod_time || ""));
      return Number.isFinite(t) ? t : 0;
    };

    arr.sort((a: any, b: any) => {
      const d = dirFirst(a, b);
      if (d !== 0) return d;

      let cmp = 0;
      if (sortKey === "name") {
        cmp = String(a?.name || "").localeCompare(String(b?.name || ""));
      } else if (sortKey === "size") {
        cmp = (Number(a?.size || 0) || 0) - (Number(b?.size || 0) || 0);
      } else if (sortKey === "mtime") {
        cmp = getMTime(a) - getMTime(b);
      }

      if (cmp === 0) {
        cmp = String(a?.name || "").localeCompare(String(b?.name || ""));
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
    return arr;
  }, [remoteEntries, sortKey, sortDir]);

  const handleSort = useCallback(
    (key: SortKey) => {
      setSortKey((prevKey) => {
        if (prevKey !== key) {
          setSortDir("asc");
          return key;
        }
        setSortDir((prevDir) => (prevDir === "asc" ? "desc" : "asc"));
        return prevKey;
      });
    },
    [],
  );

  const resizeStateRef = useRef<
    | null
    | {
        col: EntryColumn;
        startX: number;
        startWidth: number;
      }
  >(null);
  const resizeRafRef = useRef<number | null>(null);
  const resizePendingRef = useRef<number | null>(null);

  const onResizeStart = useCallback(
    (col: EntryColumn, startX: number, startWidth: number) => {
      resizeStateRef.current = { col, startX, startWidth };
      document.body.style.userSelect = "none";
      document.body.style.cursor = "col-resize";
    },
    [],
  );

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const st = resizeStateRef.current;
      if (!st) return;
      const dx = e.clientX - st.startX;
      const { min, max } = getColumnConstraints(st.col);
      const next = clampInt(st.startWidth + dx, min, max);
      resizePendingRef.current = next;
      if (resizeRafRef.current === null) {
        resizeRafRef.current = window.requestAnimationFrame(() => {
          resizeRafRef.current = null;
          const pending = resizePendingRef.current;
          if (typeof pending !== "number") return;
          setColWidths((prev) => {
            const curr = prev[st.col];
            if (curr === pending) return prev;
            return { ...prev, [st.col]: pending };
          });
        });
      }
    };

    const onUp = () => {
      if (!resizeStateRef.current) return;
      resizeStateRef.current = null;
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      if (resizeRafRef.current !== null) {
        window.cancelAnimationFrame(resizeRafRef.current);
        resizeRafRef.current = null;
      }
    };
  }, []);

  const renderEntries = useCallback(
    (entries: Array<FSEntry>, pane: PaneId) => {
      if (!entries || entries.length === 0) {
        return (
          <Box px={1.5} py={1}>
            <Typography variant="caption" color="text.secondary">
              empty directory
            </Typography>
          </Box>
        );
      }

      const selection = pane === "local" ? selectedLocal : selectedRemote;
      const dragOverDirPath =
        dragOverDir?.pane === pane && dragOverDir.path
          ? dragOverDir.path
          : null;

      // Virtualization: only render visible rows for large directories.
      // We use a fixed row height to keep calculations fast.
      const ROW_HEIGHT = 30;
      const OVERSCAN = 8;

      const HEADER_HEIGHT = 26;
      const viewportHeight = pane === "local" ? localListHeight : remoteListHeight;
      const listHeight = Math.max(120, viewportHeight - HEADER_HEIGHT);

      const itemData: FileRowProps = {
        pane,
        entries,
        selection,
        dragOverDirPath,
        assetId,
        containerId,
        hasRemoteFS,
        localPath,
        remotePath,
        entryGridTemplateColumns,
        columns,
        formatSize,
        formatMTime,
        openEntry,
        updateSelectionByClick,
        setPaneSelection,
        setPaneAnchor,
        setCtxMenu,
      };

      return (
        <Box sx={{ height: "100%", width: "100%", display: "flex", flexDirection: "column", minHeight: 0 }}>
          {/* Shared horizontal scroll container: header and list are in the same scroller. */}
          <Box
            sx={{
              flex: 1,
              minHeight: 0,
              overflowX: "auto",
              overflowY: "hidden",
            }}
          >
            <Box sx={{ minWidth: "max-content", height: "100%", display: "flex", flexDirection: "column", minHeight: 0 }}>
              <FileListHeaderRow
                columns={columns}
                gridTemplateColumns={entryGridTemplateColumns}
                widths={colWidths}
                sortKey={sortKey}
                sortDir={sortDir}
                onSort={handleSort}
                onResizeStart={onResizeStart}
              />

              {/* Vertical scrolling happens inside react-window; horizontal scroll is the parent. */}
              <Box sx={{ flex: 1, minHeight: 0 }}>
                <VirtualList
                  defaultHeight={listHeight}
                  rowCount={entries.length}
                  rowHeight={ROW_HEIGHT}
                  overscanCount={OVERSCAN}
                  rowComponent={VirtualFileRow}
                  rowProps={itemData}
                  style={{ height: "100%", width: "100%" }}
                />
              </Box>
            </Box>
          </Box>
        </Box>
      );
    },
    [
      COLUMN_ORDER,
      columns,
      entryGridTemplateColumns,
      formatMTime,
      formatSize,
      openEntry,
      selectedLocal,
      selectedRemote,
      setCtxMenu,
      setPaneAnchor,
      setPaneSelection,
      updateSelectionByClick,
      localListHeight,
      remoteListHeight,
      assetId,
      containerId,
      hasRemoteFS,
      localPath,
      remotePath,
      dragOverDir,
      colWidths,
      sortKey,
      sortDir,
      handleSort,
      onResizeStart,
    ],
  );

  // Provide a header action (layout toggle + swap panes) to be rendered in the drawer title bar.
  useEffect(() => {
    if (!onHeaderActionChange) return;
    if (!visible) return;

    // For non-SSH assets (local, etc.), hide the header actions entirely.
    if (!hasRemoteFS) {
      onHeaderActionChange(null);
      return;
    }

    const action = (
      <Box
        display="inline-flex"
        alignItems="center"
        gap={0.5}
        sx={{
          height: 28,
          lineHeight: 1,
          color: "text.primary",
        }}
      >
        <Tooltip
          title={
            layout === "horizontal"
              ? "Switch to vertical"
              : "Switch to horizontal"
          }
        >
          <IconButton
            size="small"
            onClick={toggleLayout}
            sx={{ p: 0.5, color: "inherit" }}
          >
            {layout === "horizontal" ? (
              <ViewAgendaIcon fontSize="inherit" />
            ) : (
              <ViewColumnIcon fontSize="inherit" />
            )}
          </IconButton>
        </Tooltip>

        <Tooltip
          title={
            layout === "horizontal"
              ? "Swap panes (Remote/Local left-right)"
              : "Swap panes (Remote/Local top-bottom)"
          }
        >
          <IconButton
            size="small"
            onClick={togglePaneOrder}
            sx={{ p: 0.5, color: "inherit" }}
          >
            {layout === "horizontal" ? (
              <SwapHorizIcon fontSize="inherit" />
            ) : (
              <SwapVertIcon fontSize="inherit" />
            )}
          </IconButton>
        </Tooltip>
      </Box>
    );

    onHeaderActionChange(action);
    return () => onHeaderActionChange(null);
  }, [layout, toggleLayout, togglePaneOrder, onHeaderActionChange, visible, hasRemoteFS]);

  const [menuAnchorEl, setMenuAnchorEl] = useState<null | HTMLElement>(null);
  const [menuPane, setMenuPane] = useState<PaneId>("local");

  const closeMenu = () => {
    setMenuAnchorEl(null);
  };

  const openMenu = (pane: PaneId, el: HTMLElement) => {
    setMenuPane(pane);
    setMenuAnchorEl(el);
  };

  const runRefresh = () => {
    closeMenu();
    if (menuPane === "local") void refreshLocal();
    else void refreshRemote();
  };

  const toggleColumn = (c: EntryColumn) => {
    setColumns((prev) => {
      // Don't allow toggling name off.
      if (c === "name") return prev;

      const has = prev.includes(c);
      const next = has ? prev.filter((x) => x !== c) : [...prev, c];
      // Always keep name.
      if (!next.includes("name")) next.push("name");
      return next;
    });
  };

  const renderPathBar = (opts: {
    pane: PaneId;
    label: string;
    path: string;
    editableValue: string;
    setEditableValue: (v: string) => void;
    disabled?: boolean;
  }) => {
    const isEditing = activePathEditPane === opts.pane;
    const segs = splitPathSegments(opts.path);
    const isRootPath = normalizePosixPath(opts.path) === "/";

    const scrollerRef =
      opts.pane === "local"
        ? localCrumbScrollerRef
        : remoteCrumbScrollerRef;

    // When not editing, the label is drawn in the overlay. When editing, keep it as an adornment.
    const labelRef =
      opts.pane === "local" ? localAdornmentRef : remoteAdornmentRef;

    return (
      <Box
        px={1}
        py={0.75}
        display="flex"
        alignItems="center"
        gap={0.75}
        sx={(theme) => ({
          borderBottom: `1px solid ${theme.palette.divider}`,
          flexShrink: 0,
        })}
      >
        <Box sx={{ flex: 1, minWidth: 0, position: "relative" }}>
          <OutlinedInput
            fullWidth
            size="small"
            inputRef={opts.pane === "local" ? localInputRef : remoteInputRef}
            value={opts.editableValue}
            onChange={(e) => opts.setEditableValue(e.target.value)}
            onBlur={() => {
              if (!isEditing) return;
              commitEdit(opts.pane);
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault();
                cancelEdit(opts.pane);
                return;
              }
              if (e.key === "Enter") {
                e.preventDefault();
                commitEdit(opts.pane);
                return;
              }
            }}
            // Only show the adornment while editing (otherwise it overlaps with the overlay).
            startAdornment={
              isEditing ? (
                <InputAdornment position="start" sx={{ mr: 0.75 }}>
                  <Box
                    ref={labelRef}
                    sx={{ display: "inline-flex", alignItems: "center" }}
                  >
                    <Typography
                      variant="caption"
                      color="text.secondary"
                      sx={{
                        fontSize: 11,
                        whiteSpace: "nowrap",
                        cursor: opts.disabled ? "default" : "pointer",
                      }}
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        if (opts.disabled) return;
                        if (opts.pane === "local") void navigateLocal("/");
                        else void navigateRemote("/");
                      }}
                    >
                      {opts.label}
                    </Typography>
                  </Box>
                </InputAdornment>
              ) : undefined
            }
            disabled={opts.disabled}
            sx={{
              "& .MuiOutlinedInput-input": {
                fontSize: 12,
                py: 0.75,
                ...(isEditing
                  ? {}
                  : {
                      color: "transparent",
                      caretColor: "transparent",
                      textShadow: "none",
                    }),
              },
            }}
            readOnly={!isEditing}
          />

          {!isEditing && (
            <Box
              sx={{
                position: "absolute",
                left: 0,
                top: 0,
                height: "100%",
                width: "100%",
                display: "flex",
                alignItems: "center",
                // Do not offset the overlay; we render the label inside it.
                pl: 1,
                pr: 1,
                pointerEvents: "none",
              }}
            >
              {/* Label area */}
              <Box
                ref={labelRef}
                sx={{
                  flexShrink: 0,
                  display: "inline-flex",
                  alignItems: "center",
                  pointerEvents: opts.disabled ? "none" : "auto",
                }}
              >
                <Typography
                  variant="caption"
                  color="text.secondary"
                  sx={{
                    fontSize: 11,
                    whiteSpace: "nowrap",
                    cursor: opts.disabled ? "default" : "pointer",
                    userSelect: "none",
                  }}
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    if (opts.disabled) return;
                    if (opts.pane === "local") void navigateLocal("/");
                    else void navigateRemote("/");
                  }}
                >
                  {opts.label}
                </Typography>
              </Box>

              <Box sx={{ width: 8, flexShrink: 0 }} />

              {/* Breadcrumbs area */}
              <Box
                ref={scrollerRef}
                onClick={(e) => {
                  if (opts.disabled) return;
                  e.preventDefault();
                  e.stopPropagation();
                  // Clicking the blank area should enter edit mode, not jump to root.
                  startEdit(opts.pane);
                }}
                onWheel={(e) => {
                  const el = scrollerRef.current;
                  if (!el) return;
                  if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
                    el.scrollLeft += e.deltaY;
                  } else {
                    el.scrollLeft += e.deltaX;
                  }
                  e.preventDefault();
                }}
                sx={{
                  flex: "1 1 auto",
                  minWidth: 0,
                  overflowX: "auto",
                  overflowY: "hidden",
                  whiteSpace: "nowrap",
                  pointerEvents: opts.disabled ? "none" : "auto",
                  // Left-align segments next to the label (no right-anchoring).
                  direction: "ltr",
                  scrollbarWidth: "none",
                  "&::-webkit-scrollbar": { display: "none" },
                }}
              >
                <Box sx={{ display: "inline-block", direction: "ltr" }}>
                  <Breadcrumbs
                    maxItems={undefined as any}
                    separator=""
                    sx={{
                      display: "inline-flex",
                      "& .MuiBreadcrumbs-ol": {
                        flexWrap: "nowrap",
                        whiteSpace: "nowrap",
                      },
                      "& .MuiBreadcrumbs-li": {
                        whiteSpace: "nowrap",
                      },
                      "& .MuiBreadcrumbs-separator": {
                        display: "none",
                      },
                    }}
                  >
                    {(
                      isRootPath
                        ? [
                            <Typography
                              key="/"
                              variant="caption"
                              color="text.primary"
                              sx={{
                                fontSize: 12,
                                cursor: "text",
                                userSelect: "none",
                              }}
                              noWrap
                              onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                if (opts.disabled) return;
                                startEdit(opts.pane);
                              }}
                            >
                              /
                            </Typography>,
                          ]
                        : [
                            <Link
                              key="root"
                              component="button"
                              underline="none"
                              color="text.secondary"
                              onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                if (opts.disabled) return;
                                if (opts.pane === "local") void navigateLocal("/");
                                else void navigateRemote("/");
                              }}
                              sx={(theme) => ({
                                display: "inline-flex",
                                alignItems: "center",
                                px: 0.25,
                                py: 0.25,
                                borderRadius: 1,
                                fontSize: 12,
                                lineHeight: 1,
                                userSelect: "none",
                                cursor: "pointer",
                                border: `1px solid transparent`,
                                "&:hover": {
                                  backgroundColor: theme.palette.action.hover,
                                  borderColor:
                                    theme.palette.mode === "light"
                                      ? "rgba(0,0,0,0.12)"
                                      : "rgba(255,255,255,0.18)",
                                },
                                "&:active": {
                                  backgroundColor: theme.palette.action.selected,
                                },
                              })}
                            >
                              /
                            </Link>,
                            ...segs.map((s, idx) => {
                              const isLast = idx === segs.length - 1;

                              const commonBlockSx = {
                                display: "inline-flex",
                                alignItems: "center",
                                maxWidth: "100%",
                                px: 0.75,
                                py: 0.25,
                                borderRadius: 1,
                                transition: "background-color 0.12s ease",
                                userSelect: "none",
                              } as const;

                              const Slash = !isLast ? (
                                <Typography
                                  key={`${s.path}:slash`}
                                  variant="caption"
                                  color="text.secondary"
                                  sx={{
                                    fontSize: 12,
                                    opacity: 0.6,
                                    userSelect: "none",
                                    px: 0.25,
                                  }}
                                  noWrap
                                >
                                  /
                                </Typography>
                              ) : null;

                              if (isLast) {
                                return (
                                  <Typography
                                    key={s.path}
                                    variant="caption"
                                    color="text.primary"
                                    sx={{
                                      ...commonBlockSx,
                                      fontSize: 12,
                                      cursor: "text",
                                    }}
                                    noWrap
                                    onClick={(e) => {
                                      e.preventDefault();
                                      e.stopPropagation();
                                      if (opts.disabled) return;
                                      startEdit(opts.pane);
                                    }}
                                  >
                                    {s.label}
                                  </Typography>
                                );
                              }

                              return (
                                <Box
                                  key={s.path}
                                  sx={{ display: "inline-flex", alignItems: "center" }}
                                >
                                  <Link
                                    component="button"
                                    underline="none"
                                    color="text.secondary"
                                    onClick={(e) => {
                                      e.preventDefault();
                                      e.stopPropagation();
                                      if (opts.pane === "local") void navigateLocal(s.path);
                                      else void navigateRemote(s.path);
                                    }}
                                    sx={(theme) => ({
                                      ...commonBlockSx,
                                      fontSize: 12,
                                      cursor: "pointer",
                                      minWidth: 0,
                                      border: `1px solid transparent`,
                                      "&:hover": {
                                        backgroundColor: theme.palette.action.hover,
                                        borderColor:
                                          theme.palette.mode === "light"
                                            ? "rgba(0,0,0,0.12)"
                                            : "rgba(255,255,255,0.18)",
                                      },
                                      "&:active": {
                                        backgroundColor: theme.palette.action.selected,
                                      },
                                    })}
                                  >
                                    {s.label}
                                  </Link>
                                  {Slash}
                                </Box>
                              );
                            }),
                          ]
                    )}
                  </Breadcrumbs>
                </Box>
              </Box>

              {/* Trailing spacer (click to edit) */}
              <Box
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  if (opts.disabled) return;
                  startEdit(opts.pane);
                }}
                sx={{
                  flexShrink: 0,
                  width: 24,
                  height: "100%",
                  cursor: "text",
                  pointerEvents: opts.disabled ? "none" : "auto",
                }}
              />
            </Box>
          )}
        </Box>

        <IconButton
          size="small"
          onClick={(e) => openMenu(opts.pane, e.currentTarget)}
          disabled={opts.disabled}
          sx={{ p: 0.5, "& .MuiSvgIcon-root": { fontSize: 14 } }}
        >
          <MoreVertIcon fontSize="inherit" />
        </IconButton>
      </Box>
    );
  };

  const RemotePane = hasRemoteFS ? (
    <Box display="flex" flexDirection="column" minHeight={0} height="100%">
      {renderPathBar({
        pane: "remote",
        label: "Remote",
        path: remotePath || "/",
        editableValue: remotePathInput,
        setEditableValue: setRemotePathInput,
        disabled: !assetId,
      })}

      {remoteError && (
        <Box px={1.5} pt={0.25}>
          <Typography variant="caption" color="error">
            {remoteError}
          </Typography>
        </Box>
      )}

      <Divider />

      <Box
        ref={remoteListViewportRef}
        flex={1}
        minHeight={0}
        overflow="hidden"
        position="relative"
        onDragOver={(e) => handlePaneDragOver("remote", e)}
        onDragLeave={() => handlePaneDragLeave("remote")}
        onDrop={(e) => void handlePaneDrop("remote", e)}
      >
        {/* Pane highlight only when not hovering a specific directory */}
        {dragOverPane === "remote" && !(dragOverDir?.pane === "remote" && dragOverDir.path) && (
          <Box
            sx={(theme) => ({
              position: "absolute",
              inset: 6,
              borderRadius: 1,
              border: `1px dashed ${theme.palette.primary.main}`,
              backgroundColor:
                theme.palette.mode === "light"
                  ? "rgba(25,118,210,0.06)"
                  : "rgba(144,202,249,0.10)",
              pointerEvents: "none",
              zIndex: 2,
            })}
          />
        )}
        {remoteLoading ? (
          <Box p={2} display="flex" justifyContent="center">
            <CircularProgress size={18} />
          </Box>
        ) : (
          renderEntries(sortedRemoteEntries, "remote")
        )}
      </Box>
    </Box>
  ) : null;

  const LocalPane = (
    <Box display="flex" flexDirection="column" minHeight={0} height="100%">
      {renderPathBar({
        pane: "local",
        label: "Local",
        // Display the actual host home directory in the address bar.
        // The underlying API paths are still sandbox-relative.
        path: localPath,
        editableValue: localPathInput,
        setEditableValue: setLocalPathInput,
        disabled: false,
      })}

      {localError && (
        <Box px={1.5} pt={0.25}>
          <Typography variant="caption" color="error">
            {localError}
          </Typography>
        </Box>
      )}

      <Divider />

      <Box
        ref={localListViewportRef}
        flex={1}
        minHeight={0}
        overflow="hidden"
        position="relative"
        onDragOver={(e) => handlePaneDragOver("local", e)}
        onDragLeave={() => handlePaneDragLeave("local")}
        onDrop={(e) => void handlePaneDrop("local", e)}
      >
        {/* Pane highlight only when not hovering a specific directory */}
        {dragOverPane === "local" && !(dragOverDir?.pane === "local" && dragOverDir.path) && (
          <Box
            sx={(theme) => ({
              position: "absolute",
              inset: 6,
              borderRadius: 1,
              border: `1px dashed ${theme.palette.primary.main}`,
              backgroundColor:
                theme.palette.mode === "light"
                  ? "rgba(25,118,210,0.06)"
                  : "rgba(144,202,249,0.10)",
              pointerEvents: "none",
              zIndex: 2,
            })}
          />
        )}
        {localLoading ? (
          <Box p={2} display="flex" justifyContent="center">
            <CircularProgress size={18} />
          </Box>
        ) : (
          renderEntries(sortedLocalEntries, "local")
        )}
      </Box>
    </Box>
  );

  return (
    <Box display="flex" flexDirection="column" minHeight={0} height="100%">
      {/* Status line */}
      <Box
        px={1.25}
        py={0.5}
        sx={(theme) => ({
          borderBottom: `1px solid ${theme.palette.divider}`,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 1,
          flexShrink: 0,
        })}
      >
        <Box />

        <Typography variant="caption" color="text.secondary" noWrap>
          {transferProgress
            ? `Transferring ${transferProgress.done}/${transferProgress.total}${transferProgress.current ? `: ${transferProgress.current}` : ""}`
            : transferBusy
              ? "Working…"
              : ""}
        </Typography>
      </Box>

      {transferError && (
        <Box px={1.5} pt={0.5}>
          <Typography variant="caption" color="error">
            {transferError}
          </Typography>
        </Box>
      )}

      {hasRemoteFS ? (
        paneOrder === "remote-first" ? (
          <Box
            ref={splitContainerRef}
            sx={{
              flex: 1,
              minHeight: 0,
              display: "flex",
              flexDirection: layout === "horizontal" ? "row" : "column",
              overflow: "hidden",
            }}
          >
            <Box
              sx={{
                flexBasis: `${split}%`,
                flexShrink: 0,
                minWidth: 0,
                minHeight: 0,
                overflow: "hidden",
              }}
            >
              {RemotePane}
            </Box>

            <Box
              onMouseDown={startDrag}
              sx={(theme) => ({
                ...dividerCommonSx,
                width: layout === "horizontal" ? 8 : "100%",
                height: layout === "vertical" ? 8 : "100%",
                cursor: layout === "horizontal" ? "col-resize" : "row-resize",
                "&:hover > div": {
                  bgcolor:
                    theme.palette.mode === "light"
                      ? "rgba(0,0,0,0.18)"
                      : "rgba(255,255,255,0.18)",
                },
              })}
            >
              <Box
                sx={(theme) => ({
                  width: layout === "horizontal" ? 2 : "100%",
                  height: layout === "vertical" ? 2 : "100%",
                  bgcolor:
                    theme.palette.mode === "light"
                      ? "rgba(0,0,0,0.10)"
                      : "rgba(255,255,255,0.10)",
                  borderRadius: 1,
                  transition: "background-color 0.15s",
                })}
              />
            </Box>

            <Box
              sx={{
                flexBasis: `${100 - split}%`,
                flexShrink: 0,
                minWidth: 0,
                minHeight: 0,
                overflow: "hidden",
              }}
            >
              {LocalPane}
            </Box>
          </Box>
        ) : (
          <Box
            ref={splitContainerRef}
            sx={{
              flex: 1,
              minHeight: 0,
              display: "flex",
              flexDirection: layout === "horizontal" ? "row" : "column",
              overflow: "hidden",
            }}
          >
            <Box
              sx={{
                flexBasis: `${split}%`,
                flexShrink: 0,
                minWidth: 0,
                minHeight: 0,
                overflow: "hidden",
              }}
            >
              {LocalPane}
            </Box>

            <Box
              onMouseDown={startDrag}
              sx={(theme) => ({
                ...dividerCommonSx,
                width: layout === "horizontal" ? 8 : "100%",
                height: layout === "vertical" ? 8 : "100%",
                cursor: layout === "horizontal" ? "col-resize" : "row-resize",
                "&:hover > div": {
                  bgcolor:
                    theme.palette.mode === "light"
                      ? "rgba(0,0,0,0.18)"
                      : "rgba(255,255,255,0.18)",
                },
              })}
            >
              <Box
                sx={(theme) => ({
                  width: layout === "horizontal" ? 2 : "100%",
                  height: layout === "vertical" ? 2 : "100%",
                  bgcolor:
                    theme.palette.mode === "light"
                      ? "rgba(0,0,0,0.10)"
                      : "rgba(255,255,255,0.10)",
                  borderRadius: 1,
                  transition: "background-color 0.15s",
                })}
              />
            </Box>

            <Box
              sx={{
                flexBasis: `${100 - split}%`,
                flexShrink: 0,
                minWidth: 0,
                minHeight: 0,
                overflow: "hidden",
              }}
            >
              {RemotePane}
            </Box>
          </Box>
        )
      ) : (
        // Local-only: show just the local pane.
        <Box sx={{ flex: 1, minHeight: 0, overflow: "hidden" }}>{LocalPane}</Box>
      )}

      <Menu
        anchorEl={menuAnchorEl}
        open={Boolean(menuAnchorEl)}
        onClose={closeMenu}
        anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
        transformOrigin={{ vertical: "top", horizontal: "right" }}
        MenuListProps={{
          dense: true,
          disablePadding: true,
        }}
        PaperProps={{
          sx: {
            minWidth: 180,
            // Force a smaller baseline for everything in the menu.
            fontSize: 11,
            "& .MuiMenuItem-root": {
              py: 0.25,
              px: 1,
              minHeight: 24,
              // Make icons inherit a smaller font-size reliably.
              fontSize: 11,
            },
            "& .MuiListItemIcon-root": {
              // Fixed width so all rows line up identically.
              width: 20,
              minWidth: 20,
              maxWidth: 20,
              mr: 0.5,
              color: "text.secondary",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
            },
            // Make the icon size really obvious.
            "& .MuiSvgIcon-root": { fontSize: "13px !important" },
            "& .MuiTypography-root": { fontSize: 12, lineHeight: 1.2 },
          },
        }}
      >
        <MenuItem onClick={runRefresh}>
          <ListItemIcon>
            <RefreshIcon sx={{ width: "14px", height: "14px" }} />
          </ListItemIcon>
          <Typography variant="body2">Refresh</Typography>
        </MenuItem>

        <MenuItem
          onClick={() => {
            setShowHidden((v) => !v);
          }}
        >
          <ListItemIcon>
            {showHidden ? (
              <VisibilityIcon sx={{ width: "14px", height: "14px" }} />
            ) : (
              <VisibilityOffIcon sx={{ width: "14px", height: "14px" }} />
            )}
          </ListItemIcon>
          <Typography variant="body2">Show hidden files</Typography>
        </MenuItem>

        <NestedMenuItem
          parentMenuOpen={Boolean(menuAnchorEl)}
          label="Columns"
          delay={120}
          leftIcon={
            <Box
              sx={{
                width: 20,
                minWidth: 20,
                maxWidth: 20,
                mr: 0.5,
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                color: "text.secondary",
                flexShrink: 0,
              }}
            >
              <ChecklistIcon sx={{ fontSize: "13px !important" }} />
            </Box>
          }
          rightIcon={
            <Typography variant="body2" color="text.secondary">
              ▸
            </Typography>
          }
          MenuProps={{
            anchorOrigin: { vertical: "top", horizontal: "left" },
            transformOrigin: { vertical: "top", horizontal: "right" },
            PaperProps: {
              sx: {
                // Open to the LEFT of the main menu so it doesn't cover it.
                // A small offset avoids a visible seam.
                mr: 0.5,
                minWidth: 200,
                fontSize: 11,
                "& .MuiMenuItem-root": {
                  py: 0.25,
                  px: 1,
                  minHeight: 24,
                  fontSize: 11,
                },
                "& .MuiListItemIcon-root": {
                  width: 20,
                  minWidth: 20,
                  maxWidth: 20,
                  mr: 0.5,
                  color: "text.secondary",
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                },
                "& .MuiSvgIcon-root": { fontSize: "13px !important" },
                "& .MuiTypography-root": { fontSize: 12, lineHeight: 1.2 },
              },
            },
            MenuListProps: {
              dense: true,
              disablePadding: true,
            },
          }}
        >
          <MenuItem
            onClick={() => {
              toggleColumn("mode");
            }}
          >
            <ListItemIcon>
              <input
                type="checkbox"
                checked={columns.includes("mode")}
                readOnly
                style={{ width: 12, height: 12 }}
              />
            </ListItemIcon>
            <Typography variant="body2">Mode</Typography>
          </MenuItem>

          <MenuItem
            onClick={() => {
              toggleColumn("size");
            }}
          >
            <ListItemIcon>
              <input
                type="checkbox"
                checked={columns.includes("size")}
                readOnly
                style={{ width: 12, height: 12 }}
              />
            </ListItemIcon>
            <Typography variant="body2">Size</Typography>
          </MenuItem>

          <MenuItem
            onClick={() => {
              toggleColumn("mtime");
            }}
          >
            <ListItemIcon>
              <input
                type="checkbox"
                checked={columns.includes("mtime")}
                readOnly
                style={{ width: 12, height: 12 }}
              />
            </ListItemIcon>
            <Typography variant="body2">Modified</Typography>
          </MenuItem>
        </NestedMenuItem>
      </Menu>

      <Menu
        open={Boolean(ctxMenu)}
        onClose={closeCtxMenu}
        anchorReference="anchorPosition"
        anchorPosition={
          ctxMenu !== null
            ? { top: ctxMenu.mouseY, left: ctxMenu.mouseX }
            : undefined
        }
        MenuListProps={{ dense: true, disablePadding: true }}
        PaperProps={{ sx: { minWidth: 190 } }}
      >
        <MenuItem
          disabled={transferBusy}
          onClick={() => {
            const pane = ctxMenu?.pane;
            closeCtxMenu();
            if (!pane) return;
            void handleDeleteSelection(pane);
          }}
        >
          Delete
        </MenuItem>

        <Divider />

        <MenuItem
          disabled={transferBusy || selectedCount === 0 || !hasRemoteFS}
          onClick={() => {
            const pane = ctxMenu?.pane;
            closeCtxMenu();
            if (!pane) return;

            const direction =
              pane === "local" ? "local-to-remote" : "remote-to-local";

            void enqueueTransferTask(direction);
          }}
        >
          {ctxMenu?.pane === "local" ? "Upload" : "Download"}
        </MenuItem>
      </Menu>
    </Box>
  );
}
