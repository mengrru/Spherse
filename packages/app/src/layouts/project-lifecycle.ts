import type { HostBridge } from "../lib/host-bridge";
import { useAppStore } from "../stores/app-store";
import { useProjectDataStore } from "../stores/project-data-store";
import { clearProjectQueries } from "../queries/project";
import { clearLastRoute } from "../lib/localstorage/last-route";
import { clearProjectNavHistory } from "../lib/use-project-navigation";
import { useStreamingStore } from "../features/chat/runtime/streaming-store";
import { useAgentSessionListUiStore } from "../features/agent-session-list/store";
import { useTriggerStore } from "../features/agent-trigger/store";
import { useFloatingChatStore } from "../features/floating-chat/store";
import { useFloatingContentBrowserStore } from "../features/floating-content-browser/store";
import { useBrowserStore } from "../features/browser/store";

export async function closeProjectCascade(
  bridge: HostBridge,
  projectId: string,
): Promise<string | null> {
  const nextProjectId = await useAppStore.getState().closeProject(bridge, projectId);
  useStreamingStore.getState().disconnectProject(projectId);
  clearProjectQueries(projectId);
  useAgentSessionListUiStore.getState().clearProject(projectId);
  useTriggerStore.getState().clearProject(projectId);
  useFloatingChatStore.getState().clearProject(projectId);
  useFloatingContentBrowserStore.getState().clearProject(projectId);
  useBrowserStore.getState().clearProject(projectId);
  useProjectDataStore.getState().clearProjectData(projectId);
  clearProjectNavHistory(projectId);
  clearLastRoute(projectId);
  return nextProjectId;
}
