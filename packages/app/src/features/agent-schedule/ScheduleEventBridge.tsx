import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { useI18n } from "@spherse/i18n/react";
import { useProjectCtx } from "../../context/project-context";
import { useProjectDataStore } from "../../stores/project-data-store";
import { useStreamingStore } from "../chat/streaming-store";
import { useScheduleStore } from "./store";
import { useBusSubscription } from "../../hooks/useBusSubscription";
import type { ScheduleServerEvent } from "../../lib/types";

export function ScheduleEventBridge() {
  const { projectId, client } = useProjectCtx();
  const { t } = useI18n();
  const agents = useProjectDataStore((s) => (projectId ? s.projects[projectId]?.agents ?? [] : []));
  const handleScheduleEvent = useScheduleStore((s) => s.handleScheduleEvent);
  const tRef = useRef(t);
  useEffect(() => {
    tRef.current = t;
  }, [t]);

  useEffect(() => {
    if (!projectId || !client || agents.length === 0) return;
    let cancelled = false;
    void Promise.allSettled(agents.map((agent) => client.listSchedules(agent.id))).then(
      (results) => {
        if (cancelled) return;
        for (let i = 0; i < agents.length; i++) {
          const result = results[i];
          if (result.status === "fulfilled") {
            useProjectDataStore
              .getState()
              .setHasEnabledSchedules(projectId, agents[i].id, result.value.some((s) => s.enabled));
          } else {
            console.warn(`preload schedules failed for agent ${agents[i].id}`, result.reason);
          }
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [projectId, client, agents]);

  const showScheduleNotification = async (agentId: string, scheduleId: string) => {
    if (!projectId || !client) return;
    const cachedSchedules =
      useScheduleStore.getState().byProject[projectId]?.schedulesByAgent?.[agentId] ?? [];
    let schedule = cachedSchedules.find((item) => item.id === scheduleId);
    if (!schedule) {
      const schedules = await client.listSchedules(agentId).catch(() => []);
      schedule = schedules.find((item) => item.id === scheduleId);
    }
    if (!schedule?.notify) return;
    toast.success(schedule.notificationMessage?.trim() || tRef.current("agent-schedule.notificationDefault"));
  };

  useBusSubscription(projectId ?? "", "schedule", (type, payload) => {
    if (!projectId || !client) return;
    handleScheduleEvent(projectId, client, { type, ...(payload as object) } as ScheduleServerEvent);
    if (type === "schedule_completed") {
      const p = payload as { agentId: string; scheduleId: string; sessionId: string };
      void showScheduleNotification(p.agentId, p.scheduleId);
      useStreamingStore.getState().refreshHistory(client, p.agentId, p.sessionId);
    }
  });

  return null;
}
