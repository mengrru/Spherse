import { useEffect } from "react";

export function useCustomTheme(projectRoot: string | undefined, port: number | undefined) {
  useEffect(() => {
    if (!projectRoot || !port) return;

    const existingLink = document.getElementById("custom-theme-link");
    if (existingLink) existingLink.remove();

    const link = document.createElement("link");
    link.id = "custom-theme-link";
    link.rel = "stylesheet";
    link.href = `http://localhost:${port}/api/preview/.spherse/theme.css?t=${Date.now()}`;
    link.onerror = () => {
      console.warn("[CustomTheme] Failed to load theme");
      link.remove();
    };
    document.head.appendChild(link);
  }, [projectRoot, port]);
}
