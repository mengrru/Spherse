import { FilePlusIcon, FolderPlusIcon } from "lucide-react";
import { useI18n } from "@spherse/i18n/react";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "../../components/ui/context-menu";
import type { CreateAction, TreeNode } from "./tree-model";

export function FileTreeContextMenu({
  node: _node,
  children,
  onCreate,
  onDelete,
}: {
  node: TreeNode;
  children: React.ReactNode;
  onCreate: (action: CreateAction) => void;
  onDelete: () => void;
}) {
  const { t } = useI18n();
  return (
    <ContextMenu>
      <ContextMenuTrigger>{children}</ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onClick={() => onCreate("new-file")}>
          <FilePlusIcon className="size-4" />
          {t("file-tree.newFile")}
        </ContextMenuItem>
        <ContextMenuItem onClick={() => onCreate("new-folder")}>
          <FolderPlusIcon className="size-4" />
          {t("file-tree.newFolder")}
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem variant="destructive" onClick={onDelete}>
          {t("common.delete")}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
