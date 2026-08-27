import { useI18n } from "@spherse/i18n/react";
import { toast } from "sonner";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "../../components/ui/context-menu";
import type { CreateAction, TreeItem } from "./tree-model";

export function FileTreeContextMenu({
  node,
  children,
  onCreate,
  onDelete,
  onFloatFile,
  floatedFilePaths,
}: {
  node: TreeItem;
  children: React.ReactNode;
  onCreate: (action: CreateAction) => void;
  onDelete: () => void;
  onFloatFile?: (filePath: string) => void;
  floatedFilePaths?: Set<string>;
}) {
  const { t } = useI18n();
  const isFloated = floatedFilePaths?.has(node.path) ?? false;
  return (
    <ContextMenu>
      <ContextMenuTrigger>{children}</ContextMenuTrigger>
      <ContextMenuContent>
        {onFloatFile && node.type === "file" && (
          <>
            <ContextMenuItem onClick={() => onFloatFile(node.path)}>
              {isFloated ? t("file-tree.cancelFloat") : t("file-tree.float")}
            </ContextMenuItem>
            <ContextMenuSeparator />
          </>
        )}
        <ContextMenuItem onClick={() => onCreate("new-file")}>
          {t("file-tree.newFile")}
        </ContextMenuItem>
        <ContextMenuItem onClick={() => onCreate("new-folder")}>
          {t("file-tree.newFolder")}
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem
          onClick={() => {
            navigator.clipboard.writeText(node.path).catch(() => {});
            toast.success(t("file-tree.pathCopied"));
          }}
        >
          {t("file-tree.copyPath")}
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem variant="destructive" onClick={onDelete}>
          {t("common.delete")}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
