import { useEffect } from "react";
import { useBusSubscription } from "./useBusSubscription";

const THEME_CSS_PATH = ".spherse/theme.css";

function buildThemeHref(baseUrl: string, projectId: string, accessToken: string | null): string {
  const authSegment = accessToken ? `__auth/${encodeURIComponent(accessToken)}/` : "";
  return `${baseUrl}/api/projects/${projectId}/preview/${authSegment}.spherse/theme.css?t=${Date.now()}`;
}

export function useCustomTheme(
  projectRoot: string | undefined,
  baseUrl: string | undefined,
  projectId: string | undefined,
  accessToken: string | null = null,
) {
  useEffect(() => {
    const existingLink = document.getElementById("custom-theme-link");
    if (existingLink) existingLink.remove();

    if (!projectRoot || !baseUrl || !projectId) return;

    const link = document.createElement("link");
    link.id = "custom-theme-link";
    link.rel = "stylesheet";
    link.href = buildThemeHref(baseUrl, projectId, accessToken);
    link.onerror = () => {
      link.remove();
    };
    document.head.appendChild(link);
  }, [projectRoot, baseUrl, projectId, accessToken]);

  useBusSubscription(projectId ?? "", "fs-watch", (_type, payload) => {
    if (!baseUrl || !projectId) return;
    const changedPath = (payload as { path?: string } | null)?.path?.replace(/\\/g, "/");
    if (changedPath !== THEME_CSS_PATH) return;

    const old = document.getElementById("custom-theme-link");
    if (old) old.remove();
    const fresh = document.createElement("link");
    fresh.id = "custom-theme-link";
    fresh.rel = "stylesheet";
    fresh.href = buildThemeHref(baseUrl, projectId, accessToken);
    fresh.onerror = () => {
      fresh.remove();
    };
    document.head.appendChild(fresh);
  });
}
