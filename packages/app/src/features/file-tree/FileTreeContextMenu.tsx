import { FilePlusIcon, FolderPlusIcon } from "lucide-react";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "../../components/ui/context-menu";
import type { CreateAction, TreeNode } from "./tree-model";

export function FileTreeContextMenu({
  node,
  children,
  onCreate,
  onDelete,
}: {
  node: TreeNode;
  children: React.ReactNode;
  onCreate: (action: CreateAction) => void;
  onDelete: () => void;
}) {
  return (
    <ContextMenu>
      <ContextMenuTrigger>{children}</ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onClick={() => onCreate("new-file")}>
          <FilePlusIcon className="size-4" />
          新建文件
        </ContextMenuItem>
        <ContextMenuItem onClick={() => onCreate("new-folder")}>
          <FolderPlusIcon className="size-4" />
          新建文件夹
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem variant="destructive" onClick={onDelete}>
          删除
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
