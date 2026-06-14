import { useEffect } from "react";

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
}
