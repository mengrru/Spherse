import { useMemo } from "react";
import { useI18n } from "@spherse/i18n/react";
import { useProjectCtx } from "../../context/project-context";
import { useApiClient } from "../../lib/use-connection";
import { useProjectDirectory } from "../../queries/content";
import { useFileTreeController } from "./hooks/useFileTreeController";
import { buildTreeItems } from "./tree-model";
import { FileTreeItem } from "./FileTreeNode";
import { FileTreeProvider } from "./file-tree-context";
import { InlineNameInput } from "./InlineNameInput";
import { DeleteConfirmDialog } from "./DeleteConfirmDialog";

export interface FileTreeProps {
  selectedFilePath?: string;
  onSelectFile: (filePath: string) => void;
  onDeleted?: (path: string) => void;
  onFloatFile?: (filePath: string) => void;
  floatedFilePaths?: Set<string>;
  rootPath?: string;
  emptyLabel?: string;
  readOnly?: boolean;
}

export function FileTree({ selectedFilePath, onSelectFile, onDeleted, onFloatFile, floatedFilePaths, rootPath, emptyLabel, readOnly }: FileTreeProps) {
  const { t } = useI18n();
  const { projectId } = useProjectCtx();
  const client = useApiClient(projectId);
  const basePath = rootPath ?? "";
  const ctrl = useFileTreeController(client, onDeleted, projectId);
  const rootQuery = useProjectDirectory(projectId, client, basePath);
  const items = useMemo(
    () => (rootQuery.data ? buildTreeItems(rootQuery.data, basePath) : []),
    [rootQuery.data, basePath],
  );

  const ctxValue = {
    projectId,
    client,
    selectedFilePath,
    expandedPaths: ctrl.expandedPaths,
    creating: ctrl.creating,
    selectFile: onSelectFile,
    toggleDir: ctrl.toggleDir,
    requestCreate: ctrl.requestCreate,
    submitCreate: ctrl.submitCreate,
    cancelCreate: ctrl.cancelCreate,
    requestDelete: ctrl.requestDelete,
    onFloatFile,
    floatedFilePaths,
    readOnly,
  };

  return (
    <div className="flex flex-col gap-px text-xs">
      {rootQuery.isPending ? (
        <p className="px-2 text-xs text-sidebar-foreground/70">{t("common.loading")}</p>
      ) : items.length === 0 ? (
        <p className="px-2 text-xs text-sidebar-foreground/70">{emptyLabel ?? t("file-tree.empty")}</p>
      ) : (
        <FileTreeProvider value={ctxValue}>
          {items.map((item) => (
            <FileTreeItem key={item.path} item={item} depth={0} />
          ))}
        </FileTreeProvider>
      )}
      {!readOnly && ctrl.creating && ctrl.creating.parentPath === basePath && (
        <InlineNameInput
          depth={0}
          onSubmit={(name) =>
            ctrl.submitCreate(ctrl.creating!.parentPath, ctrl.creating!.action, name)
          }
          onCancel={ctrl.cancelCreate}
        />
      )}
      {!readOnly && (
        <DeleteConfirmDialog
          target={ctrl.deleteTarget}
          onConfirm={ctrl.confirmDelete}
          onCancel={ctrl.cancelDelete}
        />
      )}
    </div>
  );
}
