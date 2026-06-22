import { useEffect } from "react";
import { useBusSubscription } from "./useBusSubscription";

const THEME_CSS_PATH = ".spherse/theme.css";

export function useCustomTheme(projectRoot: string | undefined, baseUrl: string | undefined, projectId: string | undefined) {
  useEffect(() => {
    if (!projectRoot || !baseUrl || !projectId) return;

    const existingLink = document.getElementById("custom-theme-link");
    if (existingLink) existingLink.remove();

    const link = document.createElement("link");
    link.id = "custom-theme-link";
    link.rel = "stylesheet";
    link.href = `${baseUrl}/api/projects/${projectId}/preview/.spherse/theme.css?t=${Date.now()}`;
    link.onerror = () => {
      link.remove();
    };
    document.head.appendChild(link);
  }, [projectRoot, baseUrl, projectId]);

  useBusSubscription(projectId ?? "", "fs-watch", (_type, payload) => {
    if (!baseUrl || !projectId) return;
    const changedPath = (payload as { path?: string } | null)?.path?.replace(/\\/g, "/");
    if (changedPath !== THEME_CSS_PATH) return;

    const old = document.getElementById("custom-theme-link");
    if (old) old.remove();
    const fresh = document.createElement("link");
    fresh.id = "custom-theme-link";
    fresh.rel = "stylesheet";
    fresh.href = `${baseUrl}/api/projects/${projectId}/preview/.spherse/theme.css?t=${Date.now()}`;
    fresh.onerror = () => {
      fresh.remove();
    };
    document.head.appendChild(fresh);
  });
}
