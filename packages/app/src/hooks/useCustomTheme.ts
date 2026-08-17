import { useEffect } from "react";
import { useBusSubscription } from "./useBusSubscription";
import { useReconnectedSync } from "./useReconnectedSync";

const THEME_CSS_PATH = ".spherse/theme.css";

function buildThemeHref(baseUrl: string, projectId: string, accessToken: string | null): string {
  const authSegment = accessToken ? `__auth/${encodeURIComponent(accessToken)}/` : "";
  return `${baseUrl}/api/projects/${projectId}/preview/${authSegment}.spherse/theme.css?t=${Date.now()}`;
}

function mountThemeLink(href: string): void {
  const existingLink = document.getElementById("custom-theme-link");
  if (existingLink) existingLink.remove();
  const link = document.createElement("link");
  link.id = "custom-theme-link";
  link.rel = "stylesheet";
  link.href = href;
  link.onerror = () => {
    link.remove();
  };
  document.head.appendChild(link);
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

    mountThemeLink(buildThemeHref(baseUrl, projectId, accessToken));
  }, [projectRoot, baseUrl, projectId, accessToken]);

  useBusSubscription(projectId ?? "", "fs-watch", (_type, payload) => {
    if (!baseUrl || !projectId) return;
    const changedPath = (payload as { path?: string } | null)?.path?.replace(/\\/g, "/");
    if (changedPath !== THEME_CSS_PATH) return;
    mountThemeLink(buildThemeHref(baseUrl, projectId, accessToken));
  });

  // Connection-recovered compensation: theme.css may have changed while the
  // bus was down (missed fs-watch events are not replayed).
  useReconnectedSync(() => {
    if (!baseUrl || !projectId) return;
    mountThemeLink(buildThemeHref(baseUrl, projectId, accessToken));
  });
}
