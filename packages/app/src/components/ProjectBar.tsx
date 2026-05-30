import { ProjectAvatar } from "./ProjectAvatar";
import { Button } from "./ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "./ui/context-menu";
import { PlusIcon } from "lucide-react";

interface ProjectBarProps {
  projects: Map<string, { name: string }>;
  activePath: string | null;
  onSelect: (path: string) => void;
  onAdd: () => void;
  onClose: (path: string) => void;
  onReveal: (path: string) => void;
}

export function ProjectBar({ projects, activePath, onSelect, onAdd, onClose, onReveal }: ProjectBarProps) {
  return (
    <div className="flex w-14 shrink-0 flex-col border-r border-border bg-muted/30">
      <div className="flex-1 overflow-y-auto flex flex-col gap-2 items-center py-3">
        {Array.from(projects.entries()).map(([path, info]) => (
          <ContextMenu key={path}>
            <ContextMenuTrigger>
              <ProjectAvatar
                name={info.name}
                path={path}
                active={path === activePath}
                onClick={() => onSelect(path)}
              />
            </ContextMenuTrigger>
            <ContextMenuContent>
              <ContextMenuItem onClick={() => onClose(path)}>
                关闭项目
              </ContextMenuItem>
              <ContextMenuItem onClick={() => onReveal(path)}>
                在 Finder 中显示
              </ContextMenuItem>
            </ContextMenuContent>
          </ContextMenu>
        ))}
      </div>
      <div className="mt-auto flex justify-center pb-3">
        <Button
          variant="outline"
          size="icon-lg"
          className="border-dashed"
          onClick={onAdd}
          title="添加项目"
        >
          <PlusIcon />
        </Button>
      </div>
    </div>
  );
}
