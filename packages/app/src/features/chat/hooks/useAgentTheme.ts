import { useState, useEffect } from "react";
import type { ApiClient } from "../../../lib/api";
import { scopeCss } from "../../../lib/scope-css";

export function useAgentTheme(client: ApiClient | undefined, agentId: string | undefined) {
  const [scopedCss, setScopedCss] = useState<string | null>(null);

  useEffect(() => {
    if (!client || !agentId) return;

    let cancelled = false;
    client.getAgentTheme(agentId).then((css) => {
      if (cancelled) return;
      if (css.trim()) {
        setScopedCss(scopeCss(css, "[data-chat-root]"));
      } else {
        setScopedCss(null);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [client, agentId]);

  return scopedCss;
}
