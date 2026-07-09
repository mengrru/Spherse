import { useEffect } from "react";
import { useNavigate } from "react-router";
import { dispatchAction } from "./registry";
import { checkRateLimit } from "./rate-limit";
import type { ActionContext } from "./types";
import type { ApiClient } from "../lib/api";

export function isAllowedOrigin(
  eventOrigin: string,
  rendererOrigin: string,
  serverOrigin: string | null,
): boolean {
  if (eventOrigin === "null") return true;
  if (eventOrigin === rendererOrigin) return true;
  if (serverOrigin && eventOrigin === serverOrigin) return true;
  return false;
}

export function useSpherseMessageListener(
  projectId: string,
  client: ApiClient,
): void {
  const navigate = useNavigate();

  useEffect(() => {
    const serverOrigin = client?.baseUrl ?? null;
    const rendererOrigin = window.location.origin;

    const handler = (event: MessageEvent) => {
      if (event.data?.type !== "spherse:action") return;
      if (typeof event.data.action !== "string") return;
      if (!isAllowedOrigin(event.origin, rendererOrigin, serverOrigin)) return;
      if (!checkRateLimit(event.data.action)) return;
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
