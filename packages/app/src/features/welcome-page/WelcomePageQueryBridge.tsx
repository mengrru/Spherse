import { useBusSubscription } from "../../hooks/useBusSubscription";
import { useReconnectedSync } from "../../hooks/useReconnectedSync";
import { useProjectCtx } from "../../context/project-context";
import { invalidateWelcomePage, WELCOME_PAGE_CONFIG_PATH } from "../../queries/welcome-page";

export function WelcomePageQueryBridge() {
  const { projectId } = useProjectCtx();

  useBusSubscription(projectId, "fs-watch", (_type, payload) => {
    const changedPath = (payload as { path?: string } | null)?.path?.replace(/\\/g, "/");
    if (changedPath !== WELCOME_PAGE_CONFIG_PATH) return;
    void invalidateWelcomePage(projectId);
  });

  useReconnectedSync(() => {
    void invalidateWelcomePage(projectId);
  });

  return null;
}
