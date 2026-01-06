// Asset Store - TanStack Query based state management
//
// Event handling strategy:
// - Global event subscription (not per-hook) to avoid duplicate listeners
// - Asset created/updated/deleted → refresh the list

import { useQuery, useQueryClient, QueryClient } from "@tanstack/react-query";
import { listAssets, type Asset } from "../api/assets";
import { eventClient, RECONNECT_EVENT } from "../api/event_hooks";
import { Events } from "../api/events";

// ============================================================================
// Query Keys
// ============================================================================

export const assetKeys = {
  all: ["assets"] as const,
  lists: () => [...assetKeys.all, "list"] as const,
  list: (filters?: { search?: string; type?: string }) =>
    [...assetKeys.lists(), filters] as const,
  details: () => [...assetKeys.all, "detail"] as const,
  detail: (id: string) => [...assetKeys.details(), id] as const,
};

// ============================================================================
// Query Client
// ============================================================================

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60, // 1 minute
      gcTime: 1000 * 60 * 5, // 5 minutes
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

// ============================================================================
// Global Event Subscription (singleton)
// ============================================================================

let assetEventsInitialized = false;

/**
 * Initialize global asset event subscriptions.
 * Call this once at app startup.
 */
export function initAssetEvents(qc: QueryClient) {
  if (assetEventsInitialized) return;
  assetEventsInitialized = true;

  // On asset created/updated/deleted, refresh the list
  eventClient.on(Events.ASSET_CREATED, () => {
    qc.invalidateQueries({ queryKey: assetKeys.all });
  });

  eventClient.on(Events.ASSET_UPDATED, () => {
    qc.invalidateQueries({ queryKey: assetKeys.all });
  });

  eventClient.on(Events.ASSET_DELETED, () => {
    qc.invalidateQueries({ queryKey: assetKeys.all });
  });

  // On reconnect, refresh all asset queries
  eventClient.on(RECONNECT_EVENT, () => {
    qc.invalidateQueries({ queryKey: assetKeys.all });
  });
}

// ============================================================================
// Hooks
// ============================================================================

/**
 * Hook to fetch and cache asset list.
 * Event subscriptions are handled globally, not per-hook.
 */
export function useAssetList() {

  return useQuery({
    queryKey: assetKeys.lists(),
    queryFn: listAssets,
  });
}

/**
 * Hook to get assets with computed visible list based on search/filter.
 * This is the main hook for AssetTree component.
 */
export function useAssets(search: string, typeFilter: string) {
  const { data: allAssets = [], isLoading, error } = useAssetList();

  // Compute visible assets
  const assets = computeVisibleAssets(allAssets, search, typeFilter);

  return {
    allAssets,
    assets,
    loading: isLoading,
    error,
  };
}

/**
 * Hook to manually invalidate asset queries.
 */
export function useInvalidateAssets() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: assetKeys.all });
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Compute visible assets based on search and type filter
 */
function computeVisibleAssets(
  full: Asset[],
  searchValue: string,
  typeValue: string
): Asset[] {
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

  // Search logic
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

  return full.filter(
    (a) =>
      includeSet.has(a.id) &&
      (typeValue === "all" || a.type === "folder" || a.type === typeValue)
  );
}

