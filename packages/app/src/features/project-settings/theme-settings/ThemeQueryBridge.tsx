import { useBusSubscription } from "../../../hooks/useBusSubscription";
import { useReconnectedSync } from "../../../hooks/useReconnectedSync";
import { useProjectCtx } from "../../../context/project-context";
import { invalidateThemeSettings, THEME_SETTINGS_CSS_PATH } from "../../../queries/theme-settings";

export function ThemeQueryBridge() {
  const { projectId } = useProjectCtx();

  useBusSubscription(projectId, "fs-watch", (_type, payload) => {
    const changedPath = (payload as { path?: string } | null)?.path?.replace(/\\/g, "/");
    if (changedPath !== THEME_SETTINGS_CSS_PATH) return;
    void invalidateThemeSettings(projectId);
  });

  useReconnectedSync(() => {
    void invalidateThemeSettings(projectId);
  });

  return null;
}
