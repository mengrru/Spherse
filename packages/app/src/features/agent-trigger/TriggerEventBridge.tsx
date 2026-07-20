import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { useI18n } from "@spherse/i18n/react";
import { useProjectCtx } from "../../context/project-context";
import { useApiClient } from "../../lib/use-connection";
import { useFeature } from "../../lib/use-feature";
import { useProjectDataStore } from "../../stores/project-data-store";
import { useStreamingStore } from "../chat/streaming-store";
import { useTriggerStore } from "./store";
import { useBusSubscription } from "../../hooks/useBusSubscription";
import type { TriggerServerEvent } from "../../lib/types";

export function TriggerEventBridge() {
  const { projectId } = useProjectCtx();
  const client = useApiClient(projectId);
  const { t } = useI18n();
  const triggerConfigEnabled = useFeature("agent-trigger");
  const agents = useProjectDataStore((s) => (projectId ? s.projects[projectId]?.agents ?? [] : []));
  const handleTriggerEvent = useTriggerStore((s) => s.handleTriggerEvent);
  const tRef = useRef(t);
  useEffect(() => {
    tRef.current = t;
  }, [t]);

  useEffect(() => {
    if (!triggerConfigEnabled || !projectId || !client || agents.length === 0) return;
    let cancelled = false;
    void Promise.allSettled(agents.map((agent) => client.listTriggers(agent.id))).then(
      (results) => {
        if (cancelled) return;
        for (let i = 0; i < agents.length; i++) {
          const result = results[i];
          if (result.status === "fulfilled") {
            useProjectDataStore
              .getState()
              .setHasEnabledTriggers(projectId, agents[i].id, result.value.some((t) => t.enabled));
          } else {
            console.warn(`preload triggers failed for agent ${agents[i].id}`, result.reason);
          }
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [triggerConfigEnabled, projectId, client, agents]);

  const showTriggerNotification = async (agentId: string, triggerId: string) => {
    if (!projectId || !client) return;
    const cachedTriggers =
      useTriggerStore.getState().byProject[projectId]?.triggersByAgent?.[agentId] ?? [];
    let trigger = cachedTriggers.find((item) => item.id === triggerId);
    if (!trigger) {
      const triggers = await client.listTriggers(agentId).catch(() => []);
      trigger = triggers.find((item) => item.id === triggerId);
    }
    if (!trigger?.notify) return;
    toast.success(trigger.notificationMessage?.trim() || tRef.current("agent-trigger.notificationDefault"));
  };

  useBusSubscription(projectId ?? "", "trigger", (type, payload) => {
    if (!projectId || !client) return;
    handleTriggerEvent(projectId, client, { type, ...(payload as object) } as TriggerServerEvent);
    if (type === "trigger_completed") {
      const p = payload as { agentId: string; triggerId: string; sessionId: string };
      void showTriggerNotification(p.agentId, p.triggerId);
      useStreamingStore.getState().refreshHistory(client, p.agentId, p.sessionId);
    }
  });

  return null;
}
