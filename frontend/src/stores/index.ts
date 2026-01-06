// Stores - TanStack Query based state management
//
// Uses TanStack Query with WebSocket event-driven cache invalidation.

// Asset Store
export {
  queryClient,
  assetKeys,
  useAssetList,
  useAssets,
  useInvalidateAssets,
  initAssetEvents,
} from "./assetStore";

// Tunnel Store
export {
  tunnelKeys,
  useTunnelList,
  useTunnels,
  useTunnelStats,
  useStartTunnel,
  useStopTunnel,
  useInvalidateTunnels,
  initTunnelEvents,
} from "./tunnelStore";

// Task Store
export {
  taskKeys,
  useTaskList,
  useTasks,
  useCancelTask,
  useInvalidateTasks,
  initTaskEvents,
} from "./taskStore";

// FS Store
export {
  fileManagerKeys,
  useFileManagerList,
  useInvalidateFileManager,
  initFileManagerEvents,
} from "./fileManagerStore";

