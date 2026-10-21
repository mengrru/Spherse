import { useState, useCallback, useEffect, useRef } from "react";
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
import { invalidateProjectSkillQueries } from "../../../queries/skills";

export interface FileTreeController {
  expandedPaths: ReadonlySet<string>;
  creating: CreatingState | null;
  deleteTarget: DeleteTarget | null;
  renaming: TreeItem | null;
  toggleDir: (path: string) => void;
  requestCreate: (item: TreeItem, action: CreateAction) => void;
  submitCreate: (parentPath: string, action: CreateAction, name: string) => void;
  cancelCreate: () => void;
  requestDelete: (item: TreeItem) => void;
  confirmDelete: () => void;
  cancelDelete: () => void;
  requestRename: (item: TreeItem) => void;
  submitRename: (name: string) => void;
  cancelRename: () => void;
  uploadFiles: (dirPath: string, files: File[]) => Promise<void>;
}

export function useFileTreeController(
  client: ApiClient,
  onDeleted: ((path: string) => void) | undefined,
  projectId: string,
  onRenamed?: (from: string, to: string) => void,
): FileTreeController {
  const { t } = useI18n();
  const [expandedPaths, setExpandedPaths] = useState<ReadonlySet<string>>(() => new Set());
  const [creating, setCreating] = useState<CreatingState | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);
  const [renaming, setRenaming] = useState<TreeItem | null>(null);
  const renameInFlight = useRef(false);

  useEffect(() => {
    setExpandedPaths(new Set());
    setCreating(null);
    setDeleteTarget(null);
    setRenaming(null);
  }, [projectId]);

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
    void client
      .deleteContent(target.path)
      .then(async () => {
        onDeleted?.(target.path);
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
        await invalidateProjectFileQueries(projectId, target.path);
      })
      .catch((err: unknown) => {
        toast.error(t("file-tree.deleteFailed", { message: (err as Error).message }));
      });
  }, [deleteTarget, client, onDeleted, projectId, t]);

  const cancelDelete = useCallback(() => setDeleteTarget(null), []);

  const requestRename = useCallback((item: TreeItem) => setRenaming(item), []);

  const cancelRename = useCallback(() => setRenaming(null), []);

  const submitRename = useCallback(
    async (name: string) => {
      const target = renaming;
      if (!target || renameInFlight.current) return;
      if (!name || INVALID_NAME_RE.test(name)) return;
      if (name === target.name) {
        setRenaming(null);
        return;
      }
      const toPath = childPath(parentDirPath(target.path), name);
      renameInFlight.current = true;
      try {
        await client.renameContent(target.path, toPath);
        setRenaming(null);
        setExpandedPaths((prev) => {
          const next = new Set<string>();
          let changed = false;
          for (const path of prev) {
            if (path === target.path || path.startsWith(`${target.path}/`)) {
              changed = true;
              next.add(toPath + path.slice(target.path.length));
            } else {
              next.add(path);
            }
          }
          return changed ? next : prev;
        });
        onRenamed?.(target.path, toPath);
        await invalidateProjectFileQueries(projectId, target.path);
        await invalidateProjectFileQueries(projectId, toPath);
        if (target.path === ".spherse/skills" || target.path.startsWith(".spherse/skills/")) {
          await invalidateProjectSkillQueries(projectId);
        }
      } catch (err) {
        toast.error(t("file-tree.renameFailed", { message: (err as Error).message }));
      } finally {
        renameInFlight.current = false;
      }
    },
    [renaming, client, projectId, onRenamed, t],
  );

  const uploadFiles = useCallback(
    async (dirPath: string, files: File[]) => {
      if (files.length === 0) {
        toast.info(t("file-tree.uploadNoFiles"));
        return;
      }
      const uploadedPaths: string[] = [];
      const renamedPaths: string[] = [];
      for (const file of files) {
        try {
          const res = await client.uploadFile(dirPath, file);
          uploadedPaths.push(res.path);
          if (res.renamed) renamedPaths.push(res.path);
        } catch (err) {
          toast.error(t("file-tree.uploadFailed", { message: (err as Error).message }));
        }
      }
      if (uploadedPaths.length === 0) return;
      toast.success(t("file-tree.uploadedCount", { count: uploadedPaths.length }));
      if (renamedPaths.length > 0) {
        const visible = renamedPaths.slice(0, 5).join(", ");
        const suffix = renamedPaths.length > 5 ? "…" : "";
        toast.info(t("file-tree.uploadedRenamed", { names: `${visible}${suffix}` }));
      }
      expandDir(dirPath);
      await Promise.all(
        uploadedPaths.map((p) => invalidateProjectFileQueries(projectId, p)),
      );
    },
    [client, projectId, t, expandDir],
  );

  return {
    expandedPaths,
    creating,
    deleteTarget,
    renaming,
    toggleDir,
    requestCreate,
    submitCreate,
    cancelCreate,
    requestDelete,
    confirmDelete,
    cancelDelete,
    requestRename,
    submitRename,
    cancelRename,
    uploadFiles,
  };
}
