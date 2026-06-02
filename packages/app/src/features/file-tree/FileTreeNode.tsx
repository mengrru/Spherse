import { ChevronRightIcon, FileIcon, FolderIcon } from "lucide-react";
import { Button } from "../../components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "../../components/ui/collapsible";
import type { TreeNode, CreatingState, CreateAction } from "./tree-model";
import { FileTreeContextMenu } from "./FileTreeContextMenu";
import { InlineNameInput } from "./InlineNameInput";

export function FileTreeNode({
  node,
  depth,
  onToggle,
  onCreate,
  onDelete,
  creating,
  onSubmitCreate,
  onCancelCreate,
}: {
  node: TreeNode;
  depth: number;
  onToggle: (node: TreeNode) => void;
  onCreate: (node: TreeNode, action: CreateAction) => void;
  onDelete: (node: TreeNode) => void;
  creating: CreatingState | null;
  onSubmitCreate: (parentPath: string, action: CreateAction, name: string) => void;
  onCancelCreate: () => void;
}) {
  const isCreatingInThisDir =
    creating && node.type === "directory" && creating.parentPath === node.path;

  const row = (
    <Button
      variant="ghost"
      size="default"
      className={
        node.type === "directory"
          ? "group w-full justify-start gap-2 text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
          : "w-full justify-start gap-2 text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
      }
      style={{ paddingLeft: depth * 16 + 8 }}
      onClick={() => onToggle(node)}
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
    </Button>
  );

  const menuTrigger =
    node.type === "directory" ? (
      <CollapsibleTrigger
        render={
          <Button
            variant="ghost"
            size="default"
            className="group w-full justify-start gap-2 text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
            style={{ paddingLeft: depth * 16 + 8 }}
          />
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
        onCreate={(action) => onCreate(node, action)}
        onDelete={() => onDelete(node)}
      >
        {menuTrigger}
      </FileTreeContextMenu>
    );
  }

  return (
    <Collapsible open={node.expanded} onOpenChange={() => onToggle(node)}>
      <FileTreeContextMenu
        node={node}
        onCreate={(action) => onCreate(node, action)}
        onDelete={() => onDelete(node)}
      >
        {menuTrigger}
      </FileTreeContextMenu>
      <CollapsibleContent className="ml-2">
        <div className="flex flex-col gap-px">
          {isCreatingInThisDir && creating && (
            <InlineNameInput
              depth={depth + 1}
              onSubmit={(name) =>
                onSubmitCreate(creating.parentPath, creating.action, name)
              }
              onCancel={onCancelCreate}
            />
          )}
          {node.children.map((child) => (
            <FileTreeNode
              key={child.path}
              node={child}
              depth={depth + 1}
              onToggle={onToggle}
              onCreate={onCreate}
              onDelete={onDelete}
              creating={creating}
              onSubmitCreate={onSubmitCreate}
              onCancelCreate={onCancelCreate}
            />
          ))}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
