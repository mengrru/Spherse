import { useState, useEffect, useCallback, useRef } from "react";
import type { ApiClient } from "../lib/api";
import type { FileEntry } from "../lib/types";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
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

  const handleDelete = async (node: TreeNode) => {
    const label = node.type === "directory" ? `目录「${node.name}」` : `文件「${node.name}」`;
    const ok = window.confirm(`确定要删除${label}吗？此操作不可撤销。`);
    if (!ok) return;
    try {
      await client.deleteContent(node.path);
      onDeleted?.(node.path);
      refreshExpanded(nodesRef.current).then(setRootNodes);
    } catch (err) {
      console.error("Delete failed:", err);
    }
  };

  useFsWatchRefresh(client, refreshExpanded, setRootNodes, nodesRef);

  return (
    <div className="text-[13px]">
      {rootNodes.length === 0 ? (
        <p className="text-xs text-muted-foreground">加载中...</p>
      ) : (
        rootNodes.map((node) => (
          <TreeNodeView
            key={node.path}
            node={node}
            depth={0}
            onToggle={toggleNode}
            onDelete={handleDelete}
          />
        ))
      )}
    </div>
  );
}

function TreeNodeView({
  node,
  depth,
  onToggle,
  onDelete,
}: {
  node: TreeNode;
  depth: number;
  onToggle: (node: TreeNode) => void;
  onDelete: (node: TreeNode) => void;
}) {
  return (
    <div>
      <ContextMenu>
        <ContextMenuTrigger>
          <div
            className="flex cursor-pointer items-center rounded px-1 py-[3px] transition-colors select-none hover:bg-muted"
            style={{ paddingLeft: depth * 16 + 8 }}
            onClick={() => onToggle(node)}
          >
            <span className="mr-1 text-xs">
              {node.type === "directory" ? (node.expanded ? "📂" : "📁") : "📄"}
            </span>
            <span className="overflow-hidden text-ellipsis whitespace-nowrap">{node.name}</span>
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem variant="destructive" onClick={() => onDelete(node)}>
            删除
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
      {node.expanded && node.children.map((child) => (
        <TreeNodeView
          key={child.path}
          node={child}
          depth={depth + 1}
          onToggle={onToggle}
          onDelete={onDelete}
        />
      ))}
    </div>
  );
}

function useFsWatchRefresh(
  client: ApiClient,
  refreshExpanded: (nodes: TreeNode[]) => Promise<TreeNode[]>,
  setRootNodes: React.Dispatch<React.SetStateAction<TreeNode[]>>,
  nodesRef: React.MutableRefObject<TreeNode[]>,
) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const ws = client.createFsWatchWebSocket(() => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        refreshExpanded(nodesRef.current).then(setRootNodes);
      }, 300);
    });
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      ws.close();
    };
  }, [client, refreshExpanded, setRootNodes, nodesRef]);
}
