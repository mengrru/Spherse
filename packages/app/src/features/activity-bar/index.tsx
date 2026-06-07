import { useState } from "react";
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
import { WelcomePageSettingsDialog } from "../welcome-page-settings";
import { useI18n } from "@spherse/i18n/react";

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
  const { t } = useI18n();
  const [settingsProjectKey, setSettingsProjectKey] = useState<string | null>(null);
  const settingsProject = settingsProjectKey ? projects.get(settingsProjectKey) : null;

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
              <ContextMenuItem onClick={() => setSettingsProjectKey(projectKey)}>
                {t("activity-bar.setWelcomePage")}
              </ContextMenuItem>
              <ContextMenuItem onClick={() => onReveal(projectKey)}>
                {t("activity-bar.revealInFinder")}
              </ContextMenuItem>
              <ContextMenuItem onClick={() => onClose(projectKey)}>
                {t("activity-bar.closeProject")}
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
          title={t("activity-bar.settingsTooltip")}
        >
          <SettingsIcon />
        </Button>
        <Button
          variant="outline"
          size="icon-lg"
          className="border-dashed"
          onClick={onAdd}
          title={t("activity-bar.addProjectTooltip")}
        >
          <PlusIcon />
        </Button>
      </div>
      {settingsProject && (
        <WelcomePageSettingsDialog
          key={settingsProjectKey}
          client={settingsProject.ctx.client}
          open={true}
          onOpenChange={(open) => { if (!open) setSettingsProjectKey(null); }}
        />
      )}
    </div>
  );
}
