import { useState, useEffect, useRef } from "react";
import { ProjectAvatar } from "./ProjectAvatar";

interface ProjectBarProps {
  projects: Map<string, { name: string }>;
  activePath: string | null;
  onSelect: (path: string) => void;
  onAdd: () => void;
  onClose: (path: string) => void;
  onReveal: (path: string) => void;
}

export function ProjectBar({ projects, activePath, onSelect, onAdd, onClose, onReveal }: ProjectBarProps) {
  const [contextMenuPath, setContextMenuPath] = useState<string | null>(null);
  const [menuPos, setMenuPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!contextMenuPath) return;
    const handler = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) {
        setContextMenuPath(null);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [contextMenuPath]);

  return (
    <div className="w-[56px] bg-base border-r border-[var(--border)] flex flex-col shrink-0">
      <div className="flex-1 overflow-y-auto flex flex-col gap-2 items-center py-3">
        {Array.from(projects.entries()).map(([path, info]) => (
          <ProjectAvatar
            key={path}
            name={info.name}
            path={path}
            active={path === activePath}
            onClick={() => onSelect(path)}
            onContextMenu={(e) => {
              e.preventDefault();
              setContextMenuPath(path);
              setMenuPos({ x: e.clientX, y: e.clientY });
            }}
          />
        ))}
      </div>
      <div className="mt-auto flex justify-center pb-3">
        <button
          className="w-[36px] h-[36px] flex items-center justify-center rounded-lg border border-dashed border-[var(--border)] text-[var(--muted)] text-lg hover:bg-[var(--hover)] transition-colors"
          onClick={onAdd}
          title="添加项目"
        >
          +
        </button>
      </div>
      {contextMenuPath && (
        <div
          ref={menuRef}
          className="fixed z-50 bg-surface border border-[var(--border)] rounded-md shadow-lg py-1 min-w-[160px]"
          style={{ left: menuPos.x, top: menuPos.y }}
        >
          <button
            className="w-full px-3 py-1.5 text-left text-[12px] hover:bg-[var(--hover)] transition-colors"
            onClick={() => {
              onClose(contextMenuPath);
              setContextMenuPath(null);
            }}
          >
            关闭项目
          </button>
          <button
            className="w-full px-3 py-1.5 text-left text-[12px] hover:bg-[var(--hover)] transition-colors"
            onClick={() => {
              onReveal(contextMenuPath);
              setContextMenuPath(null);
            }}
          >
            在 Finder 中显示
          </button>
        </div>
      )}
    </div>
  );
}
