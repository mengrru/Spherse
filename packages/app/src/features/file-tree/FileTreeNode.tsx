import { ChevronRightIcon, FileIcon, FolderIcon } from "lucide-react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "../../components/ui/collapsible";
import { TreeRow } from "../../components/ui/tree-row";
import type { TreeNode } from "./tree-model";
import { FileTreeContextMenu } from "./FileTreeContextMenu";
import { InlineNameInput } from "./InlineNameInput";
import { useFileTreeCtx } from "./file-tree-context";

export function FileTreeNode({ node, depth }: { node: TreeNode; depth: number }) {
  const {
    selectedFilePath,
    creating,
    toggleNode,
    requestCreate,
    submitCreate,
    cancelCreate,
    requestDelete,
  } = useFileTreeCtx();

  const isCreatingInThisDir =
    creating && node.type === "directory" && creating.parentPath === node.path;

  const isSelected = node.type === "file" && node.path === selectedFilePath;

  const row = (
    <TreeRow
      depth={depth}
      selected={isSelected}
      className={node.type === "directory" ? "group" : undefined}
      onClick={() => toggleNode(node)}
    >
      {node.type === "directory" && (
        <ChevronRightIcon className="size-4 shrink-0 text-sidebar-foreground/70 transition-transform group-data-[panel-open]:rotate-90" />
      )}
      {node.type === "directory" ? (
        <FolderIcon className="size-4 shrink-0 text-sidebar-foreground/70" />
      ) : (
        <FileIcon className="size-4 shrink-0 text-sidebar-foreground/70" />
      )}
      <span className="overflow-hidden text-ellipsis whitespace-nowrap">
        {node.name}
      </span>
    </TreeRow>
  );

  const menuTrigger =
    node.type === "directory" ? (
      <CollapsibleTrigger
        render={
          <TreeRow depth={depth} className="group" />
        }
      >
        <ChevronRightIcon className="size-4 shrink-0 text-sidebar-foreground/70 transition-transform group-data-[panel-open]:rotate-90" />
        <FolderIcon className="size-4 shrink-0 text-sidebar-foreground/70" />
        <span className="overflow-hidden text-ellipsis whitespace-nowrap">
          {node.name}
        </span>
      </CollapsibleTrigger>
    ) : (
      row
    );

  if (node.type === "file") {
    return (
      <FileTreeContextMenu
        node={node}
        onCreate={(action) => requestCreate(node, action)}
        onDelete={() => requestDelete(node)}
      >
        {menuTrigger}
      </FileTreeContextMenu>
    );
  }

  return (
    <Collapsible open={node.expanded} onOpenChange={() => toggleNode(node)}>
      <FileTreeContextMenu
        node={node}
        onCreate={(action) => requestCreate(node, action)}
        onDelete={() => requestDelete(node)}
      >
        {menuTrigger}
      </FileTreeContextMenu>
      <CollapsibleContent className="ml-2">
        <div className="flex flex-col gap-px">
          {isCreatingInThisDir && creating && (
            <InlineNameInput
              depth={depth + 1}
              onSubmit={(name) =>
                submitCreate(creating.parentPath, creating.action, name)
              }
              onCancel={cancelCreate}
            />
          )}
          {node.children.map((child) => (
            <FileTreeNode key={child.path} node={child} depth={depth + 1} />
          ))}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
