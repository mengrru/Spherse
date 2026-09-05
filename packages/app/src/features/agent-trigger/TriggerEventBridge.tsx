import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { useNavigate } from "react-router";
import { useI18n } from "@spherse/i18n/react";
import { useProjectCtx } from "../../context/project-context";

import { useTriggerStore, getCachedTriggersForAgent } from "./store";
import { useBusSubscription } from "../../hooks/useBusSubscription";
import { useReconnectedSync } from "../../hooks/useReconnectedSync";
import { invalidateProjectTriggers } from "../../queries/triggers";
import type { TriggerServerEvent } from "../../lib/types";

const INVALIDATING_EVENTS = new Set(["trigger_updated", "trigger_completed", "trigger_failed"]);

export function TriggerEventBridge() {
  const { projectId } = useProjectCtx();
  const navigate = useNavigate();
  const { t } = useI18n();
  const handleTriggerEvent = useTriggerStore((s) => s.handleTriggerEvent);
  const tRef = useRef(t);
  useEffect(() => {
    tRef.current = t;
  }, [t]);

  const showTriggerNotification = (agentId: string, triggerId: string, sessionId: string) => {
    if (!projectId) return;
    const cachedTriggers = getCachedTriggersForAgent(projectId, agentId);
    const trigger = cachedTriggers.find((item) => item.id === triggerId);
    if (!trigger?.notify) return;
    toast.success(trigger.notificationMessage?.trim() || tRef.current("agent-trigger.notificationDefault"), {
      action: {
        label: tRef.current("agent-trigger.openSession"),
        onClick: () => navigate(`/project/${projectId}/chat/${sessionId}`),
      },
    });
  };

  useBusSubscription(projectId ?? "", "trigger", (type, payload) => {
    if (!projectId) return;
    handleTriggerEvent(projectId, { type, ...(payload as object) } as TriggerServerEvent);
    if (INVALIDATING_EVENTS.has(type)) {
      void invalidateProjectTriggers(projectId);
    }
    if (type === "trigger_completed") {
      const p = payload as { agentId: string; triggerId: string; sessionId: string };
      showTriggerNotification(p.agentId, p.triggerId, p.sessionId);
    }
  });

  // Missed completion events are not replayed, so running marks may be stale
  // after a reconnect; the server exposes no running-state endpoint to
  // reconcile against, so clear them (the run itself continues server-side).
  useReconnectedSync(() => {
    void invalidateProjectTriggers(projectId);
    useTriggerStore.getState().clearRunningTriggers(projectId);
  });

  return null;
}
