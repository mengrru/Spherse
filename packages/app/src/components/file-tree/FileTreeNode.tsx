import { useMemo } from "react";
import { ChevronRightIcon, FileIcon, FolderIcon } from "lucide-react";
import { useI18n } from "@spherse/i18n/react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "../../components/ui/collapsible";
import { TreeRow } from "../../components/ui/tree-row";
import { useProjectDirectory } from "../../queries/content";
import { buildTreeItems, type TreeItem } from "./tree-model";
import { FileTreeContextMenu } from "./FileTreeContextMenu";
import { InlineNameInput } from "./InlineNameInput";
import { useFileTreeCtx } from "./file-tree-context";

export function FileTreeItem({ item, depth }: { item: TreeItem; depth: number }) {
  if (item.type === "directory") {
    return <DirectoryNode item={item} depth={depth} />;
  }
  return <FileRow item={item} depth={depth} />;
}

function FileRow({ item, depth }: { item: TreeItem; depth: number }) {
  const {
    selectedFilePath,
    selectFile,
    requestCreate,
    requestDelete,
    onFloatFile,
    floatedFilePaths,
    readOnly,
  } = useFileTreeCtx();

  const isSelected = item.path === selectedFilePath;

  const row = (
    <TreeRow depth={depth} selected={isSelected} onClick={() => selectFile(item.path)}>
      <FileIcon className="size-4 shrink-0 text-sidebar-foreground/70" />
      <span className="overflow-hidden text-ellipsis whitespace-nowrap">
        {item.name}
      </span>
    </TreeRow>
  );

  if (readOnly) {
    return row;
  }

  return (
    <FileTreeContextMenu
      node={item}
      onCreate={(action) => requestCreate(item, action)}
      onDelete={() => requestDelete(item)}
      onFloatFile={onFloatFile}
      floatedFilePaths={floatedFilePaths}
    >
      {row}
    </FileTreeContextMenu>
  );
}

function DirectoryNode({ item, depth }: { item: TreeItem; depth: number }) {
  const { t } = useI18n();
  const {
    projectId,
    client,
    expandedPaths,
    creating,
    toggleDir,
    requestCreate,
    submitCreate,
    cancelCreate,
    requestDelete,
    readOnly,
  } = useFileTreeCtx();

  const expanded = expandedPaths.has(item.path);
  const query = useProjectDirectory(projectId, client, item.path, { enabled: expanded });
  const items = useMemo(
    () => (query.data ? buildTreeItems(query.data, item.path) : []),
    [query.data, item.path],
  );
  const isCreatingInThisDir = creating && creating.parentPath === item.path;

  const trigger = (
    <CollapsibleTrigger render={<TreeRow depth={depth} className="group" />}>
      <ChevronRightIcon className="size-4 shrink-0 text-sidebar-foreground/70 transition-transform group-data-[panel-open]:rotate-90" />
      <FolderIcon className="size-4 shrink-0 text-sidebar-foreground/70" />
      <span className="overflow-hidden text-ellipsis whitespace-nowrap">
        {item.name}
      </span>
    </CollapsibleTrigger>
  );

  const content = (
    <CollapsibleContent className="ml-2">
      <div className="flex flex-col gap-px">
        {isCreatingInThisDir && creating && (
          <InlineNameInput
            depth={depth + 1}
            onSubmit={(name) => submitCreate(creating.parentPath, creating.action, name)}
            onCancel={cancelCreate}
          />
        )}
        {expanded && query.isPending && (
          <p
            style={{ paddingLeft: (depth + 1) * 16 + 8 }}
            className="text-xs text-sidebar-foreground/70"
          >
            {t("common.loading")}
          </p>
        )}
        {items.map((child) => (
          <FileTreeItem key={child.path} item={child} depth={depth + 1} />
        ))}
      </div>
    </CollapsibleContent>
  );

  if (readOnly) {
    return (
      <Collapsible open={expanded} onOpenChange={() => toggleDir(item.path)}>
        {trigger}
        {content}
      </Collapsible>
    );
  }

  return (
    <Collapsible open={expanded} onOpenChange={() => toggleDir(item.path)}>
      <FileTreeContextMenu
        node={item}
        onCreate={(action) => requestCreate(item, action)}
        onDelete={() => requestDelete(item)}
      >
        {trigger}
      </FileTreeContextMenu>
      {content}
    </Collapsible>
  );
}
