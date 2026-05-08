import { useState, useEffect, useCallback } from "react";
import type { ApiClient } from "../lib/api";
import type { FileEntry } from "../lib/types";

interface FileTreeProps {
  client: ApiClient;
  onSelectFile: (filePath: string) => void;
}

interface TreeNode {
  name: string;
  path: string;
  type: "file" | "directory";
  expanded: boolean;
  children: TreeNode[];
  loaded: boolean;
}

export function FileTree({ client, onSelectFile }: FileTreeProps) {
  const [rootNodes, setRootNodes] = useState<TreeNode[]>([]);

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

  useEffect(() => {
    loadChildren("").then((entries) => {
      setRootNodes(buildNodes(entries, ""));
    });
  }, [loadChildren]);

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
    setRootNodes([...rootNodes]);
  };

  const renderNode = (node: TreeNode, depth: number = 0) => (
    <div key={node.path}>
      <div
        className="flex items-center py-[3px] px-1 rounded cursor-pointer transition-colors hover:bg-[var(--muted-bg)] select-none"
        style={{ paddingLeft: depth * 16 + 8 }}
        onClick={() => toggleNode(node)}
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
    </div>
  );
}
