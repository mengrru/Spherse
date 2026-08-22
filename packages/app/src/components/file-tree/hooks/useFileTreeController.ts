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
  mergeRefreshedTree,
} from "../tree-model";
import { fetchProjectDirectory, invalidateProjectFileQueries, useProjectDirectory } from "../../../queries/content";

export interface FileTreeController {
  rootNodes: TreeNode[];
  loading: boolean;
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
  projectId: string,
  rootPath: string,
): FileTreeController {
  const { t } = useI18n();
  const [rootNodes, setRootNodes] = useState<TreeNode[]>([]);
  const rootQuery = useProjectDirectory(projectId, client, rootPath);
  const [creating, setCreating] = useState<CreatingState | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<TreeNode | null>(null);
  const nodesRef = useRef<TreeNode[]>([]);

  useEffect(() => {
    nodesRef.current = rootNodes;
  }, [rootNodes]);

  const loadChildren = useCallback(
    async (parentPath: string) => {
      try {
        return await fetchProjectDirectory(projectId, client, parentPath);
      } catch {
        return [];
      }
    },
    [client, projectId],
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

  const buildRefreshedRoot = useCallback(async (entries: Awaited<ReturnType<ApiClient["listContent"]>>) => {
    const root = buildNodes(entries, rootPath);
    const merged = mergeExpandedState(root, nodesRef.current);
    return refreshExpanded(merged);
  }, [refreshExpanded, rootPath]);

  const refreshTree = useCallback(async (changedPath: string) => {
    await invalidateProjectFileQueries(projectId, changedPath);
    const entries = await fetchProjectDirectory(projectId, client, rootPath);
    const refreshed = await buildRefreshedRoot(entries);
    setRootNodes((current) => mergeRefreshedTree(refreshed, current));
  }, [buildRefreshedRoot, client, projectId, rootPath]);

  useEffect(() => {
    if (!rootQuery.data) return;
    let cancelled = false;
    void buildRefreshedRoot(rootQuery.data).then((refreshed) => {
      if (cancelled) return;
      setRootNodes((current) => mergeRefreshedTree(refreshed, current));
    });
    return () => {
      cancelled = true;
    };
  }, [buildRefreshedRoot, rootQuery.data, rootQuery.dataUpdatedAt]);

  const toggleNode = useCallback(
    async (node: TreeNode) => {
      if (node.type === "file") {
        onSelectFile(node.path);
        return;
      }

      const children = node.expanded
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
        await refreshTree(targetPath);
      } catch (err) {
        toast.error(t("file-tree.createFailed", { message: (err as Error).message }));
      }
    },
    [client, refreshTree, t],
  );

  const cancelCreate = useCallback(() => setCreating(null), []);

  const requestDelete = useCallback((node: TreeNode) => setDeleteTarget(node), []);

  const confirmDelete = useCallback(() => {
    if (!deleteTarget) return;
    const node = deleteTarget;
    setDeleteTarget(null);
    void client
      .deleteContent(node.path)
      .then(async () => {
        onDeleted?.(node.path);
        await refreshTree(node.path);
      })
      .catch((err: unknown) => {
        toast.error(t("file-tree.deleteFailed", { message: (err as Error).message }));
      });
  }, [deleteTarget, client, onDeleted, refreshTree, t]);

  const cancelDelete = useCallback(() => setDeleteTarget(null), []);

  return {
    rootNodes,
    loading: rootQuery.isPending,
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
