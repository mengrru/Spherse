import { useState, useEffect, useCallback, useRef } from "react";
import type { ApiClient } from "../lib/api";
import type { FileEntry } from "../lib/types";

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

export function FileTree({ client, onSelectFile, onDeleted, refreshKey }: FileTreeProps) {
  const [rootNodes, setRootNodes] = useState<TreeNode[]>([]);
  const nodesRef = useRef<TreeNode[]>([]);
  const [contextMenu, setContextMenu] = useState<{ node: TreeNode; x: number; y: number } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

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

  const buildNodes = (entries: FileEntry[], parentPath: string): TreeNode[] => {
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
  };

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

    if (!node.loaded) {
      const entries = await loadChildren(node.path);
      node.children = buildNodes(entries, node.path);
      node.loaded = true;
    }
    node.expanded = !node.expanded;
    setRootNodes([...nodesRef.current]);
  };

  useEffect(() => {
    if (!contextMenu) return;
    const handleClick = () => setContextMenu(null);
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setContextMenu(null);
    };
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [contextMenu]);

  const handleContextMenu = (e: React.MouseEvent, node: TreeNode) => {
    e.preventDefault();
    setContextMenu({ node, x: e.clientX, y: e.clientY });
  };

  const handleDelete = async () => {
    if (!contextMenu) return;
    const { node } = contextMenu;
    const label = node.type === "directory" ? `目录「${node.name}」` : `文件「${node.name}」`;
    const ok = window.confirm(`确定要删除${label}吗？此操作不可撤销。`);
    if (!ok) return;
    setContextMenu(null);
    try {
      await client.deleteContent(node.path);
      onDeleted?.(node.path);
      refreshExpanded(nodesRef.current).then(setRootNodes);
    } catch (err) {
      console.error("Delete failed:", err);
    }
  };

  useFsWatchRefresh(client, refreshExpanded, setRootNodes, nodesRef);

  const renderNode = (node: TreeNode, depth: number = 0) => (
    <div key={node.path}>
      <div
        className="flex items-center py-[3px] px-1 rounded cursor-pointer transition-colors hover:bg-[var(--muted-bg)] select-none"
        style={{ paddingLeft: depth * 16 + 8 }}
        onClick={() => toggleNode(node)}
        onContextMenu={(e) => handleContextMenu(e, node)}
      >
        <span className="mr-1 text-xs">
          {node.type === "directory"
            ? node.expanded
              ? "📂"
              : "📁"
            : "📄"}
        </span>
        <span className="overflow-hidden text-ellipsis whitespace-nowrap">{node.name}</span>
      </div>
      {node.expanded &&
        node.children.map((child) => renderNode(child, depth + 1))}
    </div>
  );

  return (
    <div className="text-[13px]">
      {rootNodes.length === 0 ? (
        <p className="text-xs text-[var(--faint)]">加载中...</p>
      ) : (
        rootNodes.map((node) => renderNode(node))
      )}
      {contextMenu && (
        <div
          ref={menuRef}
          className="fixed z-50 bg-surface border border-[var(--border)] rounded-md shadow-lg py-1 min-w-[120px]"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <button
            className="w-full px-3 py-1.5 text-left text-[12px] text-danger hover:bg-[var(--hover)] transition-colors"
            onClick={handleDelete}
          >
            删除
          </button>
        </div>
      )}
    </div>
  );
}

function useFsWatchRefresh(
  client: ApiClient,
  refreshExpanded: (nodes: TreeNode[]) => Promise<TreeNode[]>,
  setRootNodes: React.Dispatch<React.SetStateAction<TreeNode[]>>,
  nodesRef: React.MutableRefObject<TreeNode[]>,
) {
  const timerRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    const ws = client.createFsWatchWebSocket(() => {
      clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        refreshExpanded(nodesRef.current).then(setRootNodes);
      }, 300);
    });
    return () => {
      clearTimeout(timerRef.current);
      ws.close();
    };
  }, [client, refreshExpanded, setRootNodes, nodesRef]);
}
