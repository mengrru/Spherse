import { useState, useEffect, useRef } from "react";
import type { ApiClient } from "../../../lib/api";
import { useBusSubscription } from "../../../hooks/useBusSubscription";

export function useAgentTheme(
  client: ApiClient | undefined,
  agentId: string | undefined,
  slug: string | undefined,
  projectId: string | undefined,
): string {
  const [ts, setTs] = useState(() => Date.now());
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useBusSubscription(projectId ?? "", "fs-watch", (_type, payload) => {
    if (!client || !agentId || !slug) return;
    const changedPath = (payload as { path?: string } | null)?.path?.replace(/\\/g, "/");
    if (!changedPath || !changedPath.includes("agents/") || !changedPath.endsWith("theme.css")) return;

    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      setTs(Date.now());
    }, 250);
  });

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  if (!client || !agentId || !slug) return "";

  const themeHref = `${client.getPreviewUrl(`.spherse/agents/${slug}/theme.css`)}?t=${ts}`;
  return themeHref;
}
