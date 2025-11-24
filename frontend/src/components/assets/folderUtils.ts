// Generic folder tree & path utilities
// Depends only on minimal fields for reuse across different components

export interface BasicFolder {
  id: string;
  name: string;
  parent_id: string | null;
}

export interface FolderTreeItem {
  id: string;
  name: string;
  depth: number;
}

// Build flattened tree for dropdown; first layer depth=1 (keeps indentation consistent with UI)
export function buildFolderTreeItems(folders: BasicFolder[]): FolderTreeItem[] {
  const childrenMap: Record<string, BasicFolder[]> = {};
  folders.forEach((f) => {
    const pid = f.parent_id || "__root__";
    (childrenMap[pid] ||= []).push(f);
  });
  Object.values(childrenMap).forEach((arr) =>
    arr.sort((a, b) => a.name.localeCompare(b.name)),
  );
  const res: FolderTreeItem[] = [];
  const dfs = (parentKey: string, depth: number) => {
    const arr = childrenMap[parentKey];
    if (!arr) return;
    arr.forEach((f) => {
      res.push({ id: f.id, name: f.name, depth });
      dfs(f.id, depth + 1);
    });
  };
  dfs("__root__", 1);
  return res;
}

// Generate full path (without leading /, separated by ' / ')
export function getFolderPath(id: string, folders: BasicFolder[]): string {
  const idMap: Record<string, BasicFolder> = {};
  folders.forEach((a) => {
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
  return parts.reverse().join(" / ");
}
