import { useState, useEffect, useCallback, useRef } from "react";
import { ChevronRightIcon, FileIcon, FolderIcon, FolderPlusIcon, FilePlusIcon } from "lucide-react";
import { toast } from "sonner";
import type { ApiClient } from "../lib/api";
import type { FileEntry } from "../lib/types";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
} from "./ui/alert-dialog";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "./ui/collapsible";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "./ui/context-menu";

interface FileTreeProps {
  client: ApiClient;
  onSelectFile: (filePath: string) => void;
  onDeleted?: (path: string) => void;
  refreshKey?: number;
}

interface TreeNode {
  name: string;
  path: string;
  type: "file" | "directory";
  expanded: boolean;
  children: TreeNode[];
  loaded: boolean;
}

type CreatingState = {
  parentPath: string;
  action: "new-file" | "new-folder";
};

const INVALID_NAME_RE = /[/\\:]/;

function buildNodes(entries: FileEntry[], parentPath: string): TreeNode[] {
  return entries
    .filter((e) => !e.name.startsWith("."))
    .sort((a, b) => {
      if (a.type !== b.type) return a.type === "directory" ? -1 : 1;
      return a.name.localeCompare(b.name);
    })
    .map((entry) => ({
      name: entry.name,
      path: parentPath ? `${parentPath}/${entry.name}` : entry.name,
      type: entry.type,
      expanded: false,
      children: [],
      loaded: false,
    }));
}

function updateNode(nodes: TreeNode[], path: string, update: (node: TreeNode) => TreeNode): TreeNode[] {
  return nodes.map((node) => {
    if (node.path === path) return update(node);
    if (node.children.length === 0) return node;
    return { ...node, children: updateNode(node.children, path, update) };
  });
}

export function FileTree({ client, onSelectFile, onDeleted, refreshKey }: FileTreeProps) {
  const [rootNodes, setRootNodes] = useState<TreeNode[]>([]);
  const [creating, setCreating] = useState<CreatingState | null>(null);
  const nodesRef = useRef<TreeNode[]>([]);

  useEffect(() => {
    nodesRef.current = rootNodes;
  }, [rootNodes]);

  const loadChildren = useCallback(
    async (parentPath: string): Promise<FileEntry[]> => {
      try {
        return await client.listContent(parentPath);
      } catch {
        return [];
      }
    },
    [client],
  );

  const refreshExpanded = useCallback(async (nodes: TreeNode[]): Promise<TreeNode[]> => {
    const result: TreeNode[] = [];
    for (const node of nodes) {
      if (node.type === "directory" && node.expanded && node.loaded) {
        const entries = await loadChildren(node.path);
        const refreshed = buildNodes(entries, node.path);
        const children = await refreshExpanded(refreshed.map((c) => {
          const old = node.children.find((o) => o.path === c.path);
          return old ? { ...c, expanded: old.expanded, loaded: old.loaded, children: old.children } : c;
        }));
        result.push({ ...node, children });
      } else {
        result.push(node);
      }
    }
    return result;
  }, [loadChildren]);

  useEffect(() => {
    loadChildren("").then((entries) => {
      setRootNodes(buildNodes(entries, ""));
    });
  }, [loadChildren, refreshKey]);

  const toggleNode = async (node: TreeNode) => {
    if (node.type === "file") {
      onSelectFile(node.path);
      return;
    }

    const children = node.loaded
      ? node.children
      : buildNodes(await loadChildren(node.path), node.path);
    setRootNodes((prev) =>
      updateNode(prev, node.path, (current) => ({
        ...current,
        children,
        loaded: true,
        expanded: !current.expanded,
      })),
    );
  };

  const [deleteTarget, setDeleteTarget] = useState<TreeNode | null>(null);

  const handleDelete = () => {
    if (!deleteTarget) return;
    const node = deleteTarget;
    setDeleteTarget(null);
    client.deleteContent(node.path)
      .then(() => {
        onDeleted?.(node.path);
        refreshRoot();
      })
      .catch((err) => {
        toast.error(`删除失败：${(err as Error).message}`);
      });
  };

  const handleCreate = async (parentPath: string, action: "new-file" | "new-folder", name: string) => {
    if (!name || INVALID_NAME_RE.test(name)) return;
    const targetPath = parentPath ? `${parentPath}/${name}` : name;
    try {
      if (action === "new-folder") {
        await client.mkdir(targetPath);
      } else {
        await client.touchFile(targetPath);
      }
      setCreating(null);
      refreshRoot();
    } catch (err) {
      toast.error(`创建失败：${(err as Error).message}`);
    }
  };

  const refreshRoot = useCallback(async () => {
    const entries = await loadChildren("");
    const root = buildNodes(entries, "");
    const refreshed = await refreshExpanded(root.map((n) => {
      const old = nodesRef.current.find((o) => o.path === n.path);
      return old ? { ...n, expanded: old.expanded, loaded: old.loaded, children: old.children } : n;
    }));
    setRootNodes(refreshed);
  }, [loadChildren, refreshExpanded]);

  useFsWatchRefresh(client, refreshRoot);

  return (
    <div className="flex flex-col gap-px text-xs">
      {rootNodes.length === 0 ? (
        <p className="px-2 text-xs text-sidebar-foreground/70">加载中...</p>
      ) : (
        rootNodes.map((node) => (
          <TreeNodeView
            key={node.path}
            node={node}
            depth={0}
            onToggle={toggleNode}
            onDelete={(n) => setDeleteTarget(n)}
            onCreate={(n, action) => {
              const dirPath = n.type === "directory" ? n.path : n.path.split("/").slice(0, -1).join("/");
              if (n.type === "directory" && !n.expanded) {
                toggleNode(n);
              }
              setCreating({ parentPath: dirPath, action });
            }}
            creating={creating}
            onSubmitCreate={handleCreate}
            onCancelCreate={() => setCreating(null)}
          />
        ))
      )}
      {creating && creating.parentPath === "" && (
        <InlineNameInput
          depth={0}
          onSubmit={(name) => handleCreate(creating.parentPath, creating.action, name)}
          onCancel={() => setCreating(null)}
        />
      )}
      <AlertDialog open={deleteTarget !== null} onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogTitle>确认删除</AlertDialogTitle>
          <AlertDialogDescription>
            {deleteTarget && (
              deleteTarget.type === "directory"
                ? `确定要删除目录「${deleteTarget.name}」吗？此操作不可撤销。`
                : `确定要删除文件「${deleteTarget.name}」吗？此操作不可撤销。`
            )}
          </AlertDialogDescription>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={handleDelete}>删除</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function InlineNameInput({
  depth,
  onSubmit,
  onCancel,
}: {
  depth: number;
  onSubmit: (name: string) => void;
  onCancel: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  return (
    <div style={{ paddingLeft: (depth + 1) * 16 + 8 }}>
      <Input
        ref={inputRef}
        className="h-6 text-xs"
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            const value = e.currentTarget.value.trim();
            if (value && !INVALID_NAME_RE.test(value)) {
              onSubmit(value);
            }
          }
          if (e.key === "Escape") {
            onCancel();
          }
        }}
        onBlur={() => onCancel()}
      />
    </div>
  );
}

function TreeNodeView({
  node,
  depth,
  onToggle,
  onDelete,
  onCreate,
  creating,
  onSubmitCreate,
  onCancelCreate,
}: {
  node: TreeNode;
  depth: number;
  onToggle: (node: TreeNode) => void;
  onDelete: (node: TreeNode) => void;
  onCreate: (node: TreeNode, action: "new-file" | "new-folder") => void;
  creating: CreatingState | null;
  onSubmitCreate: (parentPath: string, action: "new-file" | "new-folder", name: string) => void;
  onCancelCreate: () => void;
}) {
  const isCreatingInThisDir =
    creating && node.type === "directory" && creating.parentPath === node.path;

  if (node.type === "file") {
    return (
      <ContextMenu>
        <ContextMenuTrigger>
          <Button
            variant="ghost"
            size="default"
            className="w-full justify-start gap-2 text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
            style={{ paddingLeft: depth * 16 + 8 }}
            onClick={() => onToggle(node)}
          >
            <FileIcon className="size-4 shrink-0 text-sidebar-foreground/70" />
            <span className="overflow-hidden text-ellipsis whitespace-nowrap">{node.name}</span>
          </Button>
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem onClick={() => onCreate(node, "new-file")}>
            <FilePlusIcon className="size-4" />
            新建文件
          </ContextMenuItem>
          <ContextMenuItem onClick={() => onCreate(node, "new-folder")}>
            <FolderPlusIcon className="size-4" />
            新建文件夹
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem variant="destructive" onClick={() => onDelete(node)}>
            删除
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
    );
  }

  return (
    <Collapsible open={node.expanded} onOpenChange={() => onToggle(node)}>
      <ContextMenu>
        <ContextMenuTrigger>
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
            <span className="overflow-hidden text-ellipsis whitespace-nowrap">{node.name}</span>
          </CollapsibleTrigger>
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem onClick={() => onCreate(node, "new-file")}>
            <FilePlusIcon className="size-4" />
            新建文件
          </ContextMenuItem>
          <ContextMenuItem onClick={() => onCreate(node, "new-folder")}>
            <FolderPlusIcon className="size-4" />
            新建文件夹
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem variant="destructive" onClick={() => onDelete(node)}>
            删除
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
      <CollapsibleContent className="ml-2">
        <div className="flex flex-col gap-px">
          {isCreatingInThisDir && (
            <InlineNameInput
              depth={depth + 1}
              onSubmit={(name) => onSubmitCreate(creating.parentPath, creating.action, name)}
              onCancel={onCancelCreate}
            />
          )}
          {node.children.map((child) => (
            <TreeNodeView
              key={child.path}
              node={child}
              depth={depth + 1}
              onToggle={onToggle}
              onDelete={onDelete}
              onCreate={onCreate}
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

function useFsWatchRefresh(
  client: ApiClient,
  refreshRoot: () => Promise<void>,
) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const ws = client.createFsWatchWebSocket(() => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        refreshRoot();
      }, 300);
    });
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      ws.close();
    };
  }, [client, refreshRoot]);
}
