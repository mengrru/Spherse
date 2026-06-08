import { useState } from "react";
import { useAppStore, type ProjectState } from "../../stores/app-store";
import { ProjectAvatar } from "./ProjectAvatar";
import { Button } from "../../components/ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "../../components/ui/context-menu";
import { PanelLeftCloseIcon, PinIcon, PlusIcon, SettingsIcon } from "lucide-react";
import { DebugTools } from "../debug-tools";
import { WelcomePageSettingsDialog } from "../welcome-page-settings";
import { useI18n } from "@spherse/i18n/react";
import { cn } from "../../lib/utils";

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
  const sidePanelPinned = useAppStore((state) => state.sidePanelPinned);
  const sidePanelHovered = useAppStore((state) => state.sidePanelHovered);
  const toggleSidePanelPinned = useAppStore((state) => state.toggleSidePanelPinned);
  const showSidePanel = useAppStore((state) => state.showSidePanel);
  const hideSidePanel = useAppStore((state) => state.hideSidePanel);
  const sidePanelVisible = sidePanelPinned || sidePanelHovered;

  return (
    <>
      {!sidePanelVisible && (
        <div
          className="absolute inset-y-0 left-0 z-40 w-2"
          onMouseEnter={showSidePanel}
        />
      )}
      <div
        className={
          sidePanelPinned
            ? "relative z-40 h-full shrink-0 w-14"
            : `absolute top-0 left-0 z-40 h-full w-14 transition-transform duration-200 ease-out ${
                sidePanelVisible ? "translate-x-0" : "-translate-x-full"
              }`
        }
        {...(!sidePanelPinned && {
          onMouseEnter: showSidePanel,
          onMouseLeave: hideSidePanel,
        })}
      >
        <div className="h-full">
          <div
            className={cn(
              "flex h-full w-14 shrink-0 flex-col border-r border-border",
              sidePanelPinned ? "bg-muted/30" : "bg-muted",
            )}
          >
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
                onClick={toggleSidePanelPinned}
                title={
                  sidePanelPinned
                    ? t("activity-bar.autoCollapseSidePanelTooltip")
                    : t("activity-bar.pinSidePanelTooltip")
                }
                aria-pressed={sidePanelPinned}
              >
                {sidePanelPinned ? <PanelLeftCloseIcon /> : <PinIcon />}
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
            {settingsProject && (
              <WelcomePageSettingsDialog
                key={settingsProjectKey}
                client={settingsProject.ctx.client}
                open={true}
                onOpenChange={(open) => { if (!open) setSettingsProjectKey(null); }}
              />
            )}
          </div>
        </div>
      </div>
    </>
  );
}
