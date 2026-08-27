import { useState, useCallback } from "react";
import { toast } from "sonner";
import { useI18n } from "@spherse/i18n/react";
import type { ApiClient } from "../../../lib/api";
import {
  type TreeItem,
  type CreatingState,
  type DeleteTarget,
  type CreateAction,
  INVALID_NAME_RE,
  parentDirPath,
  childPath,
} from "../tree-model";
import { invalidateProjectFileQueries } from "../../../queries/content";

export interface FileTreeController {
  expandedPaths: ReadonlySet<string>;
  creating: CreatingState | null;
  deleteTarget: DeleteTarget | null;
  toggleDir: (path: string) => void;
  requestCreate: (item: TreeItem, action: CreateAction) => void;
  submitCreate: (parentPath: string, action: CreateAction, name: string) => void;
  cancelCreate: () => void;
  requestDelete: (item: TreeItem) => void;
  confirmDelete: () => void;
  cancelDelete: () => void;
}

export function useFileTreeController(
  client: ApiClient,
  onDeleted: ((path: string) => void) | undefined,
  projectId: string,
): FileTreeController {
  const { t } = useI18n();
  const [expandedPaths, setExpandedPaths] = useState<ReadonlySet<string>>(() => new Set());
  const [creating, setCreating] = useState<CreatingState | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);

  const toggleDir = useCallback((path: string) => {
    setExpandedPaths((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  }, []);

  const expandDir = useCallback((path: string) => {
    setExpandedPaths((prev) => {
      if (prev.has(path)) return prev;
      const next = new Set(prev);
      next.add(path);
      return next;
    });
  }, []);

  const requestCreate = useCallback(
    (item: TreeItem, action: CreateAction) => {
      const parentPath = item.type === "directory" ? item.path : parentDirPath(item.path);
      if (item.type === "directory") {
        expandDir(item.path);
      }
      setCreating({ parentPath, action });
    },
    [expandDir],
  );

  const submitCreate = useCallback(
    async (parentPath: string, action: CreateAction, name: string) => {
      if (!name || INVALID_NAME_RE.test(name)) return;
      const targetPath = childPath(parentPath, name);
      try {
        if (action === "new-folder") {
          await client.mkdir(targetPath);
        } else {
          await client.touchFile(targetPath);
        }
        setCreating(null);
        await invalidateProjectFileQueries(projectId, targetPath);
      } catch (err) {
        toast.error(t("file-tree.createFailed", { message: (err as Error).message }));
      }
    },
    [client, projectId, t],
  );

  const cancelCreate = useCallback(() => setCreating(null), []);

  const requestDelete = useCallback(
    (item: TreeItem) => setDeleteTarget({ name: item.name, path: item.path, type: item.type }),
    [],
  );

  const confirmDelete = useCallback(() => {
    if (!deleteTarget) return;
    const target = deleteTarget;
    setDeleteTarget(null);
    setExpandedPaths((prev) => {
      const next = new Set<string>();
      let changed = false;
      for (const path of prev) {
        if (path === target.path || path.startsWith(`${target.path}/`)) {
          changed = true;
          continue;
        }
        next.add(path);
      }
      return changed ? next : prev;
    });
    void client
      .deleteContent(target.path)
      .then(async () => {
        onDeleted?.(target.path);
        await invalidateProjectFileQueries(projectId, target.path);
      })
      .catch((err: unknown) => {
        toast.error(t("file-tree.deleteFailed", { message: (err as Error).message }));
      });
  }, [deleteTarget, client, onDeleted, projectId, t]);

  const cancelDelete = useCallback(() => setDeleteTarget(null), []);

  return {
    expandedPaths,
    creating,
    deleteTarget,
    toggleDir,
    requestCreate,
    submitCreate,
    cancelCreate,
    requestDelete,
    confirmDelete,
    cancelDelete,
  };
}
