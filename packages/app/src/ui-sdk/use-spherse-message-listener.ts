import { useEffect } from "react";
import { useNavigate } from "react-router";
import { dispatchAction } from "./registry";
import { checkRateLimit } from "./rate-limit";
import type { ActionContext } from "./types";
import { useAppStore } from "../stores/app-store";

export function useSpherseMessageListener(projectId: string): void {
  const navigate = useNavigate();
  const project = useAppStore((s) => s.projects.get(projectId));

  useEffect(() => {
    if (!project) return;

    const serverOrigin = project.ctx.client?.baseUrl ?? null;

    const handler = (event: MessageEvent) => {
      if (event.data?.type !== "spherse:action") return;
      if (typeof event.data.action !== "string") return;
      if (event.origin !== "null" && (!serverOrigin || event.origin !== serverOrigin)) return;
      if (!checkRateLimit()) return;
      const ctx: ActionContext = {
        navigate,
        projectId,
        client: project.ctx.client,
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
  }, [navigate, projectId, project]);
}
