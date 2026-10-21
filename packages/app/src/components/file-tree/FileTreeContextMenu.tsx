import { useI18n } from "@spherse/i18n/react";
import { toast } from "sonner";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "../../components/ui/context-menu";
import { parentDirPath, type CreateAction, type TreeItem } from "./tree-model";

export function FileTreeContextMenu({
  node,
  children,
  onCreate,
  onDelete,
  onRename,
  onUploadFiles,
  onFloatFile,
  floatedFilePaths,
  onSplitFile,
  splitFilePath,
}: {
  node: TreeItem;
  children: React.ReactNode;
  onCreate: (action: CreateAction) => void;
  onDelete: () => void;
  onRename?: (node: TreeItem) => void;
  onUploadFiles?: (dirPath: string) => void;
  onFloatFile?: (filePath: string) => void;
  floatedFilePaths?: Set<string>;
  onSplitFile?: (filePath: string) => void;
  splitFilePath?: string | null;
}) {
  const { t } = useI18n();
  const isFloated = floatedFilePaths?.has(node.path) ?? false;
  const isSplit = splitFilePath === node.path;
  const isFile = node.type === "file";
  const hasViewItems = isFile && (onFloatFile || onSplitFile);
  return (
    <ContextMenu>
      <ContextMenuTrigger>{children}</ContextMenuTrigger>
      <ContextMenuContent>
        {onRename && (
          <>
            <ContextMenuItem onClick={() => onRename(node)}>
              {t("common.rename")}
            </ContextMenuItem>
            <ContextMenuSeparator />
          </>
        )}
        {isFile && onFloatFile && (
          <ContextMenuItem onClick={() => onFloatFile(node.path)}>
            {isFloated ? t("file-tree.cancelFloat") : t("file-tree.float")}
          </ContextMenuItem>
        )}
        {isFile && onSplitFile && (
          <ContextMenuItem onClick={() => onSplitFile(node.path)}>
            {isSplit ? t("file-tree.cancelSplit") : t("file-tree.split")}
          </ContextMenuItem>
        )}
        {hasViewItems && <ContextMenuSeparator />}
        <ContextMenuItem onClick={() => onCreate("new-file")}>
          {t("file-tree.newFile")}
        </ContextMenuItem>
        <ContextMenuItem onClick={() => onCreate("new-folder")}>
          {t("file-tree.newFolder")}
        </ContextMenuItem>
        {onUploadFiles && (
          <ContextMenuItem
            onClick={() =>
              onUploadFiles(
                node.type === "directory" ? node.path : parentDirPath(node.path),
              )
            }
          >
            {t("file-tree.uploadFiles")}
          </ContextMenuItem>
        )}
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
