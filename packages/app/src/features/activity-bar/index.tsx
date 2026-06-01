import type { ProjectState } from "../../stores/app-store";
import { ProjectAvatar } from "./ProjectAvatar";
import { Button } from "../../components/ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "../../components/ui/context-menu";
import { PlusIcon, SettingsIcon } from "lucide-react";
import { DebugTools } from "../debug-tools";

interface ActivityBarProps {
  projects: Map<string, ProjectState>;
  activeProjectKey: string | null;
  onSelect: (projectKey: string) => void;
  onAdd: () => void;
  onClose: (projectKey: string) => void;
  onReveal: (projectKey: string) => void;
  onSettings: () => void;
}

export function ActivityBar({
  projects,
  activeProjectKey,
  onSelect,
  onAdd,
  onClose,
  onReveal,
  onSettings,
}: ActivityBarProps) {
  return (
    <div className="flex w-14 shrink-0 flex-col border-r border-border bg-muted/30">
      <div className="flex-1 overflow-y-auto flex flex-col gap-2 items-center py-3">
        {Array.from(projects.entries()).map(([projectKey, info]) => (
          <ContextMenu key={projectKey}>
            <ContextMenuTrigger>
              <ProjectAvatar
                name={info.name}
                path={info.path}
                active={projectKey === activeProjectKey}
                onClick={() => onSelect(projectKey)}
              />
            </ContextMenuTrigger>
            <ContextMenuContent>
              <ContextMenuItem onClick={() => onClose(projectKey)}>
                关闭项目
              </ContextMenuItem>
              <ContextMenuItem onClick={() => onReveal(projectKey)}>
                在 Finder 中显示
              </ContextMenuItem>
            </ContextMenuContent>
          </ContextMenu>
        ))}
      </div>
      <div className="mt-auto flex flex-col items-center gap-2 pb-3">
        <DebugTools />
        <Button
          variant="ghost"
          size="icon-lg"
          onClick={onSettings}
          title="设置"
        >
          <SettingsIcon />
        </Button>
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
