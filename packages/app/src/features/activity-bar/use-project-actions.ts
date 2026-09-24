import { useNavigate } from "react-router";
import { toast } from "sonner";
import { useI18n } from "@spherse/i18n/react";
import { useAppStore } from "../../stores/app-store";
import { useHostBridge } from "../../context/host-bridge-context";
import { closeProjectCascade } from "../../layouts/project-lifecycle";
import type { NavState } from "../../lib/nav-state";

export function buildProjectRoute(projectId: string, lastRoute?: string): string {
  const suffix = lastRoute?.startsWith("/") ? lastRoute : "";
  return `/project/${projectId}${suffix}`;
}

export function useProjectActions() {
  const navigate = useNavigate();
  const { t } = useI18n();
  const bridge = useHostBridge();
  const openProject = useAppStore((s) => s.openProject);
  const openProjectFolder = useAppStore((s) => s.openProjectFolder);

  const handleAddProject = async () => {
    try {
      const projectId = await openProject(bridge);
      if (projectId) {
        const project = useAppStore.getState().projects.get(projectId);
        navigate(buildProjectRoute(projectId, project?.lastRoute));
      }
    } catch (err) {
      console.error("[activity-bar] failed to open project:", err);
      toast.error(t("activity-bar.openProjectFailed"));
    }
  };

  const handleSelectProject = async (projectId: string) => {
    const project = useAppStore.getState().projects.get(projectId);
    navigate(buildProjectRoute(projectId, project?.lastRoute));
  };

  const handleCloseProject = async (projectId: string) => {
    const nextProjectId = await closeProjectCascade(bridge, projectId);
    const state: NavState = { skipLeaveGuard: true };
    if (nextProjectId) {
      const project = useAppStore.getState().projects.get(nextProjectId);
      navigate(buildProjectRoute(nextProjectId, project?.lastRoute), { state });
    } else {
      navigate("/", { state });
    }
  };

  const handleOpenProjectFolder = (projectId: string) => {
    void openProjectFolder(bridge, projectId);
  };

  return { handleAddProject, handleSelectProject, handleCloseProject, handleOpenProjectFolder };
}
