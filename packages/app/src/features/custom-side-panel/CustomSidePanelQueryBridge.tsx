import { useBusSubscription } from "../../hooks/useBusSubscription";
import { useReconnectedSync } from "../../hooks/useReconnectedSync";
import { useProjectCtx } from "../../context/project-context";
import { invalidateCustomSidePanel, PROJECT_CONFIG_PATH } from "../../queries/custom-side-panel";

export function CustomSidePanelQueryBridge() {
  const { projectId } = useProjectCtx();

  useBusSubscription(projectId, "fs-watch", (_type, payload) => {
    const changedPath = (payload as { path?: string } | null)?.path?.replace(/\\/g, "/");
    if (changedPath !== PROJECT_CONFIG_PATH) return;
    void invalidateCustomSidePanel(projectId);
  });

  useReconnectedSync(() => {
    void invalidateCustomSidePanel(projectId);
  });

  return null;
}
