import { useMemo } from "react";
import type { DragEvent } from "react";
import { ChevronRightIcon, FileIcon, FolderIcon } from "lucide-react";
import { useI18n } from "@spherse/i18n/react";
import { cn } from "@/lib/utils";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "../../components/ui/collapsible";
import { TreeRow } from "../../components/ui/tree-row";
import { useProjectDirectory } from "../../queries/content";
import { buildTreeItems, parentDirPath, type TreeItem } from "./tree-model";
import { hasFileDrag, extractDroppedFiles } from "./dnd";
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
    onSplitFile,
    splitFilePath,
    readOnly,
    dropFiles,
    dropTargetDir,
    setDropTargetDir,
  } = useFileTreeCtx();

  const isSelected = item.path === selectedFilePath;

  const dragHandlers = dropFiles
    ? {
        onDragOver: (e: DragEvent) => {
          if (!hasFileDrag(e.dataTransfer)) return;
          e.preventDefault();
          e.stopPropagation();
          e.dataTransfer.dropEffect = "copy";
          setDropTargetDir(item.path);
        },
        onDragLeave: (e: DragEvent) => {
          if (!hasFileDrag(e.dataTransfer)) return;
          e.stopPropagation();
          const related = e.relatedTarget;
          if (related instanceof Node && e.currentTarget.contains(related)) return;
          setDropTargetDir((prev) => (prev === item.path ? null : prev));
        },
        onDrop: (e: DragEvent) => {
          if (!hasFileDrag(e.dataTransfer)) return;
          e.preventDefault();
          e.stopPropagation();
          setDropTargetDir(null);
          dropFiles(parentDirPath(item.path), extractDroppedFiles(e.dataTransfer));
        },
      }
    : {};

  const row = (
    <TreeRow
      depth={depth}
      selected={isSelected}
      className={dropTargetDir === item.path ? "bg-sidebar-accent ring-1 ring-sidebar-ring" : undefined}
      onClick={() => selectFile(item.path)}
      {...dragHandlers}
    >
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
      onSplitFile={onSplitFile}
      splitFilePath={splitFilePath}
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
    dropFiles,
    dropTargetDir,
    setDropTargetDir,
  } = useFileTreeCtx();

  const expanded = expandedPaths.has(item.path);
  const query = useProjectDirectory(projectId, client, item.path, { enabled: expanded });
  const items = useMemo(
    () => (query.data ? buildTreeItems(query.data, item.path) : []),
    [query.data, item.path],
  );
  const isCreatingInThisDir = creating && creating.parentPath === item.path;

  const dragHandlers = dropFiles
    ? {
        onDragOver: (e: DragEvent) => {
          if (!hasFileDrag(e.dataTransfer)) return;
          e.preventDefault();
          e.stopPropagation();
          e.dataTransfer.dropEffect = "copy";
          setDropTargetDir(item.path);
        },
        onDragLeave: (e: DragEvent) => {
          if (!hasFileDrag(e.dataTransfer)) return;
          e.stopPropagation();
          const related = e.relatedTarget;
          if (related instanceof Node && e.currentTarget.contains(related)) return;
          setDropTargetDir((prev) => (prev === item.path ? null : prev));
        },
        onDrop: (e: DragEvent) => {
          if (!hasFileDrag(e.dataTransfer)) return;
          e.preventDefault();
          e.stopPropagation();
          setDropTargetDir(null);
          dropFiles(item.path, extractDroppedFiles(e.dataTransfer));
        },
      }
    : {};

  const trigger = (
    <CollapsibleTrigger
      render={
        <TreeRow
          depth={depth}
          className={cn(
            "group",
            dropTargetDir === item.path && "bg-sidebar-accent ring-1 ring-sidebar-ring",
          )}
          {...dragHandlers}
        />
      }
    >
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
