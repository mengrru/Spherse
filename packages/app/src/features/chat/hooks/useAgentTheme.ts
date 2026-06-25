import { useState, useEffect, useRef, useCallback } from "react";
import type { ApiClient } from "../../../lib/api";
import { useBusSubscription } from "../../../hooks/useBusSubscription";

export function useAgentTheme(
  client: ApiClient | undefined,
  agentId: string | undefined,
  projectId: string | undefined,
) {
  const [themeCss, setThemeCss] = useState<string | null>(null);
  const reqIdRef = useRef(0);

  const loadTheme = useCallback(() => {
    if (!client || !agentId) return;
    const reqId = ++reqIdRef.current;
    client.getAgentTheme(agentId).then((css) => {
      if (reqId !== reqIdRef.current) return;
      setThemeCss(css.trim() ? css : null);
    });
  }, [client, agentId]);

  useEffect(() => {
    loadTheme();
  }, [loadTheme]);

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useBusSubscription(projectId ?? "", "fs-watch", (_type, payload) => {
    if (!client || !agentId) return;
    const changedPath = (payload as { path?: string } | null)?.path?.replace(/\\/g, "/");
    if (!changedPath || !changedPath.includes("agents/") || !changedPath.endsWith("theme.css")) return;

    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      loadTheme();
    }, 250);
  });

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  return themeCss;
}
