import { useEffect } from "react";
import { useNavigate } from "react-router";
import { dispatchAction } from "./registry";
import { checkRateLimit } from "./rate-limit";
import type { ActionContext } from "./types";
import { useAppStore } from "../stores/app-store";

export function useSpherseMessageListener(projectKey: string): void {
  const navigate = useNavigate();
  const project = useAppStore((s) => s.projects.get(projectKey));

  useEffect(() => {
    if (!project) return;

    const ctx: ActionContext = {
      navigate,
      projectKey,
      client: project.ctx.client,
    };

    const handler = (event: MessageEvent) => {
      if (event.data?.type !== "spherse:action") return;
      if (typeof event.data.action !== "string") return;
      if (!checkRateLimit()) return;
      void dispatchAction(
        event.data.action,
        event.data.params ?? {},
        ctx,
      );
    };

    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, [navigate, projectKey, project]);
}
