import { useI18n } from "@spherse/i18n/react";
import { useProjectCtx } from "../../lib/project-context";
import type { FileTreeController } from "./hooks/useFileTreeController";
import { useFileTreeController } from "./hooks/useFileTreeController";
import { FileTreeNode } from "./FileTreeNode";
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
  const ctrl: FileTreeController = useFileTreeController(
    client,
    onSelectFile,
    onDeleted,
    refreshKey,
  );

  return (
    <div className="flex flex-col gap-px text-xs">
      {ctrl.rootNodes.length === 0 ? (
        <p className="px-2 text-xs text-sidebar-foreground/70">{t("common.loading")}</p>
      ) : (
        ctrl.rootNodes.map((node) => (
          <FileTreeNode
            key={node.path}
            node={node}
            depth={0}
            selectedFilePath={selectedFilePath}
            onToggle={ctrl.toggleNode}
            onCreate={ctrl.requestCreate}
            onDelete={ctrl.requestDelete}
            creating={ctrl.creating}
            onSubmitCreate={ctrl.submitCreate}
            onCancelCreate={ctrl.cancelCreate}
          />
        ))
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
