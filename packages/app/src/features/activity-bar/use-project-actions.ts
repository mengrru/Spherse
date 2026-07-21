import { useNavigate } from "react-router";
import { useAppStore } from "../../stores/app-store";
import { useProjectDataStore } from "../../stores/project-data-store";
import { clearLastRoute } from "../../lib/localstorage/last-route";
import { useHostBridge } from "../../context/host-bridge-context";
import { useAgentSessionListUiStore } from "../agent-session-list/store";
import { useTriggerStore } from "../agent-trigger/store";
import { useFloatingChatStore } from "../floating-chat/store";

export function buildProjectRoute(projectId: string, lastRoute?: string): string {
  const suffix = lastRoute?.startsWith("/") ? lastRoute : "";
  return `/project/${projectId}${suffix}`;
}

export function useProjectActions() {
  const navigate = useNavigate();
  const bridge = useHostBridge();
  const openProject = useAppStore((s) => s.openProject);
  const closeProject = useAppStore((s) => s.closeProject);
  const openProjectFolder = useAppStore((s) => s.openProjectFolder);
  const setActiveProject = useAppStore((s) => s.setActiveProject);
  const clearProjectData = useProjectDataStore((s) => s.clearProjectData);
  const clearAgentSessionListUi = useAgentSessionListUiStore((s) => s.clearProject);
  const clearTriggerData = useTriggerStore((s) => s.clearProject);
  const clearFloatingChat = useFloatingChatStore((s) => s.clearProject);

  const handleAddProject = async () => {
    const projectId = await openProject(bridge);
    if (projectId) {
      const project = useAppStore.getState().projects.get(projectId);
      navigate(buildProjectRoute(projectId, project?.lastRoute));
    }
  };

  const handleSelectProject = async (projectId: string) => {
    await setActiveProject(bridge, projectId);
    const project = useAppStore.getState().projects.get(projectId);
    navigate(buildProjectRoute(projectId, project?.lastRoute));
  };

  const handleCloseProject = async (projectId: string) => {
    const nextProjectId = await closeProject(bridge, projectId);
    clearProjectData(projectId);
    clearAgentSessionListUi(projectId);
    clearTriggerData(projectId);
    clearFloatingChat(projectId);
    clearLastRoute(projectId);
    if (nextProjectId) {
      const project = useAppStore.getState().projects.get(nextProjectId);
      navigate(buildProjectRoute(nextProjectId, project?.lastRoute));
    } else {
      navigate("/");
    }
  };

  const handleOpenProjectFolder = (projectId: string) => {
    void openProjectFolder(bridge, projectId);
  };

  return { handleAddProject, handleSelectProject, handleCloseProject, handleOpenProjectFolder };
}
