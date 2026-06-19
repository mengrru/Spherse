import { useI18n } from "@spherse/i18n/react";
import { useProjectCtx } from "../../lib/project-context";
import { useFileTreeController } from "./hooks/useFileTreeController";
import { FileTreeNode } from "./FileTreeNode";
import { FileTreeProvider } from "./file-tree-context";
import { InlineNameInput } from "./InlineNameInput";
import { DeleteConfirmDialog } from "./DeleteConfirmDialog";

export interface FileTreeProps {
  selectedFilePath?: string;
  onSelectFile: (filePath: string) => void;
  onDeleted?: (path: string) => void;
  refreshKey?: number;
}

export function FileTree({ selectedFilePath, onSelectFile, onDeleted, refreshKey }: FileTreeProps) {
  const { t } = useI18n();
  const { client } = useProjectCtx();
  const ctrl = useFileTreeController(client, onSelectFile, onDeleted, refreshKey);

  const ctxValue = {
    selectedFilePath,
    creating: ctrl.creating,
    toggleNode: ctrl.toggleNode,
    requestCreate: ctrl.requestCreate,
    submitCreate: ctrl.submitCreate,
    cancelCreate: ctrl.cancelCreate,
    requestDelete: ctrl.requestDelete,
  };

  return (
    <div className="flex flex-col gap-px text-xs">
      {ctrl.rootNodes.length === 0 ? (
        <p className="px-2 text-xs text-sidebar-foreground/70">{t("common.loading")}</p>
      ) : (
        <FileTreeProvider value={ctxValue}>
          {ctrl.rootNodes.map((node) => (
            <FileTreeNode key={node.path} node={node} depth={0} />
          ))}
        </FileTreeProvider>
      )}
      {ctrl.creating && ctrl.creating.parentPath === "" && (
        <InlineNameInput
          depth={0}
          onSubmit={(name) =>
            ctrl.submitCreate(ctrl.creating!.parentPath, ctrl.creating!.action, name)
          }
          onCancel={ctrl.cancelCreate}
        />
      )}
      <DeleteConfirmDialog
        target={ctrl.deleteTarget}
        onConfirm={ctrl.confirmDelete}
        onCancel={ctrl.cancelDelete}
      />
    </div>
  );
}
