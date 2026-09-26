import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { useNavigate } from "react-router";
import { useI18n } from "@spherse/i18n/react";
import { useProjectCtx } from "../../context/project-context";
import { useTriggerStore, getCachedTriggersForAgent } from "./store";
import { useBusSubscription } from "../../hooks/useBusSubscription";
import { useReconnectedSync } from "../../hooks/useReconnectedSync";
import { invalidateProjectTriggers } from "../../queries/triggers";
import { useSettingsStore } from "../../stores/settings-store";
import { useHostBridge } from "../../context/host-bridge-context";
import type { TriggerServerEvent } from "../../lib/types";

const INVALIDATING_EVENTS = new Set(["trigger_updated", "trigger_completed", "trigger_failed"]);

export function TriggerEventBridge() {
  const { projectId } = useProjectCtx();
  const navigate = useNavigate();
  const { t } = useI18n();
  const bridge = useHostBridge();
  const handleTriggerEvent = useTriggerStore((s) => s.handleTriggerEvent);
  const tRef = useRef(t);
  useEffect(() => {
    tRef.current = t;
  }, [t]);

  const showSystemNotice = (title: string, body: string) => {
    const settings = useSettingsStore.getState();
    if (!settings.systemNotifications) return;
    if (document.hasFocus()) return;
    bridge.notifications?.show({ title, body });
  };

  const showTriggerNotification = (
    type: "trigger_completed" | "trigger_failed",
    agentId: string,
    triggerId: string,
    sessionId?: string,
  ) => {
    if (!projectId) return;
    const cachedTriggers = getCachedTriggersForAgent(projectId, agentId);
    const trigger = cachedTriggers.find((item) => item.id === triggerId);
    if (!trigger?.notify) return;
    if (type === "trigger_failed") {
      const title = tRef.current("push.triggerFailedTitle", { name: trigger.name || triggerId });
      const body = tRef.current("push.triggerFailedBody");
      const openSession = sessionId
        ? {
            label: tRef.current("agent-trigger.openSession"),
            onClick: () => navigate(`/project/${projectId}/chat/${sessionId}`),
          }
        : undefined;
      toast.error(title, openSession ? { action: openSession } : undefined);
      showSystemNotice(title, body);
      return;
    }
    const title = trigger.notificationMessage?.trim() || tRef.current("agent-trigger.notificationDefault");
    toast.success(title, {
      action: {
        label: tRef.current("agent-trigger.openSession"),
        onClick: () => navigate(`/project/${projectId}/chat/${sessionId ?? ""}`),
      },
    });
    showSystemNotice(
      tRef.current("push.triggerCompletedTitle", { name: trigger.name || triggerId }),
      title,
    );
  };

  useBusSubscription(projectId ?? "", "trigger", (type, payload) => {
    if (!projectId) return;
    handleTriggerEvent(projectId, { type, ...(payload as object) } as TriggerServerEvent);
    if (INVALIDATING_EVENTS.has(type)) {
      void invalidateProjectTriggers(projectId);
    }
    if (type === "trigger_completed") {
      const p = payload as { agentId: string; triggerId: string; sessionId: string };
      showTriggerNotification("trigger_completed", p.agentId, p.triggerId, p.sessionId);
    }
    if (type === "trigger_failed") {
      const p = payload as { agentId: string; triggerId: string; sessionId?: string };
      showTriggerNotification("trigger_failed", p.agentId, p.triggerId, p.sessionId);
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
