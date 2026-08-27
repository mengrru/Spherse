import type { FileEntry } from "../../lib/types";

type TreeItemType = "file" | "directory";

export interface TreeItem {
  name: string;
  path: string;
  type: TreeItemType;
}

export type CreateAction = "new-file" | "new-folder";

export interface CreatingState {
  parentPath: string;
  action: CreateAction;
}

export interface DeleteTarget {
  name: string;
  path: string;
  type: TreeItemType;
}

export const INVALID_NAME_RE = /[/\\:]/;

export function childPath(parentPath: string, name: string): string {
  return parentPath ? `${parentPath}/${name}` : name;
}

export function parentDirPath(path: string): string {
  const idx = path.lastIndexOf("/");
  return idx === -1 ? "" : path.slice(0, idx);
}

export function buildTreeItems(entries: FileEntry[], parentPath: string): TreeItem[] {
  return entries
    .filter((e) => !e.name.startsWith("."))
    .sort((a, b) => {
      if (a.type !== b.type) return a.type === "directory" ? -1 : 1;
      return a.name.localeCompare(b.name);
    })
    .map((entry) => ({
      name: entry.name,
      path: childPath(parentPath, entry.name),
      type: entry.type,
    }));
}
