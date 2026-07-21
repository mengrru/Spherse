import { useState } from "react";
import { useAppStore } from "../../stores/app-store";
import { useAppUiStore } from "../../stores/app-ui-store";
import { useProjectActions } from "./use-project-actions";
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
import { useFeature } from "../../lib/use-feature";
import { useHostBridge } from "../../context/host-bridge-context";
import { useApiClient } from "../../lib/use-connection";
import { useI18n } from "@spherse/i18n/react";

interface PinToggle {
  pinned: boolean;
  onToggle: () => void;
}

interface ActivityBarProps {
  pinToggle?: PinToggle;
}

export function ActivityBar({ pinToggle }: ActivityBarProps) {
  const { t } = useI18n();
  const projects = useAppStore((state) => state.projects);
  const activeProjectId = useAppStore((state) => state.activeProjectId);
  const settingsEnabled = useFeature("settings");
  const openProjectEnabled = useFeature("open-project");
  const setSettingsModalOpen = useAppUiStore((s) => s.setSettingsModalOpen);
  const canEditProject = useHostBridge().capabilities.content.editable;
  const { handleAddProject, handleSelectProject, handleCloseProject, handleOpenProjectFolder } =
    useProjectActions();
  const [settingsProjectId, setSettingsProjectId] = useState<string | null>(null);
  const settingsProject = settingsProjectId ? projects.get(settingsProjectId) : null;
  const settingsClient = useApiClient(settingsProjectId);
  const [themeSettingsProjectId, setThemeSettingsProjectId] = useState<string | null>(null);
  const themeSettingsProject = themeSettingsProjectId ? projects.get(themeSettingsProjectId) : null;
  const themeClient = useApiClient(themeSettingsProjectId);

  return (
    <div className="h-full w-[52px] shrink-0">
      <div
        data-activity-bar
        className="flex h-full w-[52px] shrink-0 flex-col border-r border-border bg-muted"
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
                  onClick={() => handleSelectProject(projectId)}
                />
              </ContextMenuTrigger>
              <ContextMenuContent>
                {canEditProject && projectId === activeProjectId && (
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
                <ContextMenuItem onClick={() => handleOpenProjectFolder(projectId)}>
                  {t("activity-bar.openProjectFolder")}
                </ContextMenuItem>
                <ContextMenuItem onClick={() => handleCloseProject(projectId)}>
                  {t("activity-bar.closeProject")}
                </ContextMenuItem>
              </ContextMenuContent>
            </ContextMenu>
              );
            })}
        </div>
        <div className="mt-auto flex flex-col items-center gap-2 pb-3">
          <DebugTools />
          {pinToggle && (
            <Button
              variant="ghost"
              size="icon-lg"
              onClick={pinToggle.onToggle}
              title={
                pinToggle.pinned
                  ? t("activity-bar.autoCollapseSidePanelTooltip")
                  : t("activity-bar.pinSidePanelTooltip")
              }
              aria-pressed={pinToggle.pinned}
            >
              {pinToggle.pinned ? <PanelLeftCloseIcon /> : <PinIcon />}
            </Button>
          )}
          {settingsEnabled && (
            <Button
              variant="ghost"
              size="icon-lg"
              onClick={() => setSettingsModalOpen(true)}
              title={t("activity-bar.settingsTooltip")}
            >
              <SettingsIcon />
            </Button>
          )}
          {openProjectEnabled && (
            <Button
              variant="outline"
              size="icon-lg"
              className="border-dashed"
              onClick={handleAddProject}
              title={t("activity-bar.addProjectTooltip")}
            >
              <PlusIcon />
            </Button>
          )}
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
  );
}
