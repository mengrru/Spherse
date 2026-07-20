import { useState } from "react";
import type { ProjectState } from "../../stores/app-store";
import { useSidePanel } from "../../hooks/use-side-panel";
import { ProjectAvatar } from "./ProjectAvatar";
import { Button } from "../../components/ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "../../components/ui/context-menu";
import { PanelLeftCloseIcon, PinIcon, PlusIcon, SettingsIcon } from "lucide-react";
import { DebugTools } from "../debug-tools";
import { WelcomePageSettingsDialog } from "../project-settings/welcome-page-settings";
import { ThemeSettingsDialog } from "../project-settings/theme-settings";
import { useApiClient } from "../../lib/use-connection";
import { useI18n } from "@spherse/i18n/react";
import { cn } from "../../lib/utils";

interface ActivityBarProps {
  projects: Map<string, ProjectState>;
  activeProjectId: string | null;
  onSelect: (projectId: string) => void;
  onAdd: () => void;
  onClose: (projectId: string) => void;
  onOpenProjectFolder: (projectId: string) => void;
  onSettings: () => void;
}

export function ActivityBar({
  projects,
  activeProjectId,
  onSelect,
  onAdd,
  onClose,
  onOpenProjectFolder,
  onSettings,
}: ActivityBarProps) {
  const { t } = useI18n();
  const [settingsProjectId, setSettingsProjectId] = useState<string | null>(null);
  const settingsProject = settingsProjectId ? projects.get(settingsProjectId) : null;
  const settingsClient = useApiClient(settingsProjectId);
  const [themeSettingsProjectId, setThemeSettingsProjectId] = useState<string | null>(null);
  const themeSettingsProject = themeSettingsProjectId ? projects.get(themeSettingsProjectId) : null;
  const themeClient = useApiClient(themeSettingsProjectId);
  const { pinned, visible, togglePin, show, hide } = useSidePanel();

  return (
    <>
      {!visible && (
        <div
          className="absolute inset-y-0 left-0 z-40 w-2"
          onMouseEnter={show}
        />
      )}
      <div
        className={
          pinned
            ? "relative z-40 h-full shrink-0 w-[52px]"
            : `absolute top-0 left-0 z-40 h-full w-[52px] transition-transform duration-200 ease-out ${
                visible ? "translate-x-0" : "-translate-x-full"
              }`
        }
        {...(!pinned && {
          onMouseEnter: show,
          onMouseLeave: hide,
        })}
      >
        <div className="h-full">
          <div
            className={cn(
              "flex h-full w-[52px] shrink-0 flex-col border-r border-border",
              pinned ? "bg-muted/30" : "bg-muted",
            )}
          >
            <div className="flex-1 overflow-y-auto flex flex-col gap-2 items-center py-3">
              {Array.from(projects.values())
                .sort((a, b) => b.lastOpened.localeCompare(a.lastOpened))
                .map((info) => {
                  const projectId = info.id;
                  return (
                <ContextMenu key={projectId}>
                  <ContextMenuTrigger>
                    <ProjectAvatar
                      name={info.name}
                      active={projectId === activeProjectId}
                      onClick={() => onSelect(projectId)}
                    />
                  </ContextMenuTrigger>
                  <ContextMenuContent>
                    {projectId === activeProjectId && (
                      <ContextMenuSub>
                        <ContextMenuSubTrigger>
                          {t("activity-bar.settings")}
                        </ContextMenuSubTrigger>
                        <ContextMenuSubContent>
                          <ContextMenuItem onClick={() => setSettingsProjectId(projectId)}>
                            {t("activity-bar.settings.welcomePage")}
                          </ContextMenuItem>
                          <ContextMenuItem onClick={() => setThemeSettingsProjectId(projectId)}>
                            {t("activity-bar.settings.theme")}
                          </ContextMenuItem>
                        </ContextMenuSubContent>
                      </ContextMenuSub>
                    )}
                    <ContextMenuItem onClick={() => onOpenProjectFolder(projectId)}>
                      {t("activity-bar.openProjectFolder")}
                    </ContextMenuItem>
                    <ContextMenuItem onClick={() => onClose(projectId)}>
                      {t("activity-bar.closeProject")}
                    </ContextMenuItem>
                  </ContextMenuContent>
                </ContextMenu>
                  );
                })}
            </div>
            <div className="mt-auto flex flex-col items-center gap-2 pb-3">
              <DebugTools />
              <Button
                variant="ghost"
                size="icon-lg"
                onClick={togglePin}
                title={
                  pinned
                    ? t("activity-bar.autoCollapseSidePanelTooltip")
                    : t("activity-bar.pinSidePanelTooltip")
                }
                aria-pressed={pinned}
              >
                {pinned ? <PanelLeftCloseIcon /> : <PinIcon />}
              </Button>
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
            {settingsProject && settingsClient && (
              <WelcomePageSettingsDialog
                key={settingsProjectId}
                client={settingsClient}
                open={true}
                onOpenChange={(open) => { if (!open) setSettingsProjectId(null); }}
              />
            )}
            {themeSettingsProject && themeClient && (
              <ThemeSettingsDialog
                key={themeSettingsProjectId}
                client={themeClient}
                open={true}
                onOpenChange={(open) => { if (!open) setThemeSettingsProjectId(null); }}
              />
            )}
          </div>
        </div>
      </div>
    </>
  );
}
