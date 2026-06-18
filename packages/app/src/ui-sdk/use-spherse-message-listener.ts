import { useEffect } from "react";
import { useNavigate } from "react-router";
import { dispatchAction } from "./registry";
import { checkRateLimit } from "./rate-limit";
import type { ActionContext } from "./types";
import type { ApiClient } from "../lib/api";

export function useSpherseMessageListener(
  projectId: string,
  client: ApiClient,
): void {
  const navigate = useNavigate();

  useEffect(() => {
    const serverOrigin = client?.baseUrl ?? null;

    const handler = (event: MessageEvent) => {
      if (event.data?.type !== "spherse:action") return;
      if (typeof event.data.action !== "string") return;
      if (event.origin !== "null" && (!serverOrigin || event.origin !== serverOrigin)) return;
      if (!checkRateLimit()) return;
      const ctx: ActionContext = {
        navigate,
        projectId,
        client,
        source: event.source,
        requestId: event.data.requestId,
      };
      void dispatchAction(
        event.data.action,
        event.data.params ?? {},
        ctx,
      );
    };

    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, [navigate, projectId, client]);
}
