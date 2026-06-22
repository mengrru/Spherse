import { useEffect, useRef } from "react";
import { Outlet, useLocation, useParams } from "react-router";
import { toast } from "sonner";
import { useI18n } from "@spherse/i18n/react";
import { ProjectPanel } from "../features/project-panel";
import { FloatingChatManager } from "../features/floating-chat";
import { useCustomTheme } from "../hooks/useCustomTheme";
import { useSidePanel } from "../hooks/use-side-panel";
import { useSpherseMessageListener } from "../ui-sdk";
import { useProjectDataStore } from "../stores/project-data-store";
import { useAppStore } from "../stores/app-store";
import { useScheduleStore } from "../features/agent-schedule/store";
import { ProjectProvider } from "../context/project-context";
import type { ApiClient } from "../lib/api";
import type { ScheduleServerEvent } from "../lib/types";
import { useBusSubscription } from "../hooks/useBusSubscription";

async function preloadHasEnabledSchedules(projectId: string, client: ApiClient) {
  const agents = useProjectDataStore.getState().projects[projectId]?.agents ?? [];
  const results = await Promise.allSettled(
    agents.map((agent) => client.listSchedules(agent.id)),
  );
  for (let i = 0; i < agents.length; i++) {
    const result = results[i];
    const agentId = agents[i].id;
    if (result.status === "fulfilled") {
      useProjectDataStore
        .getState()
        .setHasEnabledSchedules(projectId, agentId, result.value.some((s) => s.enabled));
    } else {
      console.warn(`preload schedules failed for agent ${agentId}`, result.reason);
    }
  }
}

export function ProjectScope() {
  const { projectId } = useParams();
  const location = useLocation();
  const { t } = useI18n();
  const project = useAppStore((s) => (projectId ? s.projects.get(projectId) : undefined));
  const client = project?.ctx.client;
  const initializing = useAppStore((s) => s.initializing);
  const setActiveProject = useAppStore((s) => s.setActiveProject);
  const setProjectLastRoute = useAppStore((s) => s.setProjectLastRoute);
  const { clickAwayProps } = useSidePanel();
  const refreshAgents = useProjectDataStore((s) => s.refreshAgents);
  const refreshSessions = useProjectDataStore((s) => s.refreshSessions);
  const handleScheduleEvent = useScheduleStore((s) => s.handleScheduleEvent);
  const tRef = useRef(t);
  useEffect(() => {
    tRef.current = t;
  }, [t]);

  useCustomTheme(
    project?.ctx.projectRoot ?? "",
    project?.ctx.baseUrl ?? "",
    project?.ctx.projectId ?? "",
  );
  useSpherseMessageListener(projectId ?? "", client);

  useEffect(() => {
    if (projectId) void setActiveProject(projectId);
  }, [projectId, setActiveProject]);

  useEffect(() => {
    if (!projectId) return;
    const fullPath = location.pathname + location.search;
    const prefix = `/project/${projectId}`;
    const subRoute = fullPath.startsWith(prefix) ? fullPath.slice(prefix.length) || "/" : "/";
    void setProjectLastRoute(projectId, subRoute);
  }, [location.pathname, location.search, projectId, setProjectLastRoute]);

  useEffect(() => {
    if (!projectId || !client) return;
    const cached = useProjectDataStore.getState().projects[projectId];
    if (cached?.agents?.length) return;
    void refreshAgents(projectId, client).then(() => {
      void refreshSessions(projectId, client);
      void preloadHasEnabledSchedules(projectId, client);
    });
  }, [client, projectId, refreshAgents, refreshSessions]);

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
      const p = payload as { agentId: string; scheduleId: string };
      void showScheduleNotification(p.agentId, p.scheduleId);
    }
  });

  if (!projectId || !project) {
    return (
      <div className="flex h-full flex-1 items-center justify-center text-muted-foreground">
        {initializing ? t("common.loading") : t("pages.projectNotFound")}
      </div>
    );
  }

  return (
    <ProjectProvider projectId={projectId} ctx={project.ctx}>
      <div className="relative flex h-full flex-1 overflow-hidden">
        <ProjectPanel />
        <main
          className="flex-1 overflow-hidden flex flex-col"
          {...clickAwayProps}
        >
          <Outlet />
        </main>
        <FloatingChatManager />
      </div>
    </ProjectProvider>
  );
}
