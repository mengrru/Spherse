import { useState, useEffect, useCallback, useRef } from "react";
import { toast } from "sonner";
import { useI18n } from "@spherse/i18n/react";
import type { ApiClient } from "../../../lib/api";
import {
  type TreeNode,
  type CreatingState,
  type CreateAction,
  INVALID_NAME_RE,
  buildNodes,
  updateNode,
  mergeExpandedState,
} from "../tree-model";
import { useFsWatchRefresh } from "./useFsWatchRefresh";

export interface FileTreeController {
  rootNodes: TreeNode[];
  creating: CreatingState | null;
  deleteTarget: TreeNode | null;
  toggleNode: (node: TreeNode) => void;
  requestCreate: (node: TreeNode, action: CreateAction) => void;
  submitCreate: (parentPath: string, action: CreateAction, name: string) => void;
  cancelCreate: () => void;
  requestDelete: (node: TreeNode) => void;
  confirmDelete: () => void;
  cancelDelete: () => void;
}

export function useFileTreeController(
  client: ApiClient,
  onSelectFile: (filePath: string) => void,
  onDeleted: ((path: string) => void) | undefined,
  refreshKey: number | undefined,
  projectId: string,
): FileTreeController {
  const { t } = useI18n();
  const [rootNodes, setRootNodes] = useState<TreeNode[]>([]);
  const [creating, setCreating] = useState<CreatingState | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<TreeNode | null>(null);
  const nodesRef = useRef<TreeNode[]>([]);

  useEffect(() => {
    nodesRef.current = rootNodes;
  }, [rootNodes]);

  const loadChildren = useCallback(
    async (parentPath: string) => {
      try {
        return await client.listContent(parentPath);
      } catch {
        return [];
      }
    },
    [client],
  );

  const refreshExpanded = useCallback(
    async (nodes: TreeNode[]): Promise<TreeNode[]> => {
      const result: TreeNode[] = [];
      for (const node of nodes) {
        if (node.type === "directory" && node.expanded && node.loaded) {
          const entries = await loadChildren(node.path);
          const children = buildNodes(entries, node.path);
          const merged = mergeExpandedState(children, node.children);
          const recursed = await refreshExpanded(merged);
          result.push({ ...node, children: recursed });
        } else {
          result.push(node);
        }
      }
      return result;
    },
    [loadChildren],
  );

  const refreshRoot = useCallback(async () => {
    const entries = await loadChildren("");
    const root = buildNodes(entries, "");
    const merged = mergeExpandedState(root, nodesRef.current);
    const refreshed = await refreshExpanded(merged);
    setRootNodes(refreshed);
  }, [loadChildren, refreshExpanded]);

  useEffect(() => {
    loadChildren("").then((entries) => {
      setRootNodes(buildNodes(entries, ""));
    });
  }, [loadChildren, refreshKey]);

  const toggleNode = useCallback(
    async (node: TreeNode) => {
      if (node.type === "file") {
        onSelectFile(node.path);
        return;
      }

      const children = node.loaded
        ? node.children
        : buildNodes(await loadChildren(node.path), node.path);
      setRootNodes((prev) =>
        updateNode(prev, node.path, (current) => ({
          ...current,
          children,
          loaded: true,
          expanded: !current.expanded,
        })),
      );
    },
    [onSelectFile, loadChildren],
  );

  const requestCreate = useCallback(
    (node: TreeNode, action: CreateAction) => {
      const dirPath =
        node.type === "directory"
          ? node.path
          : node.path.split("/").slice(0, -1).join("/");
      if (node.type === "directory" && !node.expanded) {
        toggleNode(node);
      }
      setCreating({ parentPath: dirPath, action });
    },
    [toggleNode],
  );

  const submitCreate = useCallback(
    async (parentPath: string, action: CreateAction, name: string) => {
      if (!name || INVALID_NAME_RE.test(name)) return;
      const targetPath = parentPath ? `${parentPath}/${name}` : name;
      try {
        if (action === "new-folder") {
          await client.mkdir(targetPath);
        } else {
          await client.touchFile(targetPath);
        }
        setCreating(null);
        refreshRoot();
      } catch (err) {
        toast.error(t("file-tree.createFailed", { message: (err as Error).message }));
      }
    },
    [client, refreshRoot, t],
  );

  const cancelCreate = useCallback(() => setCreating(null), []);

  const requestDelete = useCallback((node: TreeNode) => setDeleteTarget(node), []);

  const confirmDelete = useCallback(() => {
    if (!deleteTarget) return;
    const node = deleteTarget;
    setDeleteTarget(null);
    client
      .deleteContent(node.path)
      .then(() => {
        onDeleted?.(node.path);
        refreshRoot();
      })
      .catch((err: unknown) => {
        toast.error(t("file-tree.deleteFailed", { message: (err as Error).message }));
      });
  }, [deleteTarget, client, onDeleted, refreshRoot, t]);

  const cancelDelete = useCallback(() => setDeleteTarget(null), []);

  useFsWatchRefresh(projectId, refreshRoot);

  return {
    rootNodes,
    creating,
    deleteTarget,
    toggleNode,
    requestCreate,
    submitCreate,
    cancelCreate,
    requestDelete,
    confirmDelete,
    cancelDelete,
  };
}
