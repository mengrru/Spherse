import type { FileEntry } from "../../lib/types";

export interface TreeNode {
  name: string;
  path: string;
  type: "file" | "directory";
  expanded: boolean;
  children: TreeNode[];
  loaded: boolean;
}

export type CreateAction = "new-file" | "new-folder";

export interface CreatingState {
  parentPath: string;
  action: CreateAction;
}

export const INVALID_NAME_RE = /[/\\:]/;

export function buildNodes(entries: FileEntry[], parentPath: string): TreeNode[] {
  return entries
    .filter((e) => !e.name.startsWith("."))
    .sort((a, b) => {
      if (a.type !== b.type) return a.type === "directory" ? -1 : 1;
      return a.name.localeCompare(b.name);
    })
    .map((entry) => ({
      name: entry.name,
      path: parentPath ? `${parentPath}/${entry.name}` : entry.name,
      type: entry.type,
      expanded: false,
      children: [],
      loaded: false,
    }));
}

export function updateNode(
  nodes: TreeNode[],
  path: string,
  update: (node: TreeNode) => TreeNode,
): TreeNode[] {
  return nodes.map((node) => {
    if (node.path === path) return update(node);
    if (node.children.length === 0) return node;
    return { ...node, children: updateNode(node.children, path, update) };
  });
}

export function mergeExpandedState(
  newNodes: TreeNode[],
  oldNodes: TreeNode[],
): TreeNode[] {
  return newNodes.map((node) => {
    const old = oldNodes.find((o) => o.path === node.path);
    if (!old) return node;
    return {
      ...node,
      expanded: old.expanded,
      loaded: old.loaded,
      children: old.children,
    };
  });
}

export function mergeRefreshedTree(
  refreshedNodes: TreeNode[],
  currentNodes: TreeNode[],
): TreeNode[] {
  return refreshedNodes.map((node) => {
    const current = currentNodes.find((item) => item.path === node.path);
    if (!current) return node;
    return {
      ...node,
      expanded: current.expanded,
      loaded: current.loaded,
      children: node.loaded
        ? mergeRefreshedTree(node.children, current.children)
        : current.children,
    };
  });
}
