import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { toast } from "sonner";
import { AgentDialog } from "./AgentDialog";
import {
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupContent,
  SidebarGroupLabel,
} from "../../components/ui/sidebar";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "../../components/ui/alert-dialog";
import type { AgentProfile, SessionInfo } from "../../lib/types";
import { useProjectDataStore } from "../../stores/project-data-store";
import { useAgentSessionListUiStore } from "./store";
import { useProjectCtx } from "../../lib/project-context";
import { useFloatingSessionId } from "../floating-chat/use-floating-session-id";
import { AgentSessionListView } from "./AgentSessionListView";
import { ScheduleDialog } from "../agent-schedule";
import { PlusIcon } from "lucide-react";
import { useI18n } from "@spherse/i18n/react";
import { dispatchAction } from "../../ui-sdk";

const EMPTY_AGENTS: AgentProfile[] = [];
const EMPTY_SESSIONS: SessionInfo[] = [];
const EMPTY_COLLAPSED_AGENT_IDS = new Set<string>();

export function AgentSessionList() {
  const { t } = useI18n();
  const { projectId = "", sessionId: activeSessionId = null } = useParams();
  const navigate = useNavigate();
  const { client } = useProjectCtx();
  const projectData = useProjectDataStore((state) => state.projects[projectId]);
  const createSession = useProjectDataStore((state) => state.createSession);
  const deleteSession = useProjectDataStore((state) => state.deleteSession);
  const renameSession = useProjectDataStore((state) => state.renameSession);
  const createAgent = useProjectDataStore((state) => state.createAgent);
  const updateAgent = useProjectDataStore((state) => state.updateAgent);
  const deleteAgent = useProjectDataStore((state) => state.deleteAgent);
  const toggleAgentCollapsed = useAgentSessionListUiStore((state) => state.toggleAgentCollapsed);
  const setCollapsedAgentIds = useAgentSessionListUiStore((state) => state.setCollapsedAgentIds);
  const floatingSessionId = useFloatingSessionId(projectId);
  const [showCreateAgent, setShowCreateAgent] = useState(false);
  const [editAgent, setEditAgent] = useState<{ id: string; content: string; themeContent: string } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AgentProfile | null>(null);
  const [deleteSessionTarget, setDeleteSessionTarget] = useState<SessionInfo | null>(null);
  const [scheduleAgent, setScheduleAgent] = useState<AgentProfile | null>(null);

  const agents = projectData?.agents ?? EMPTY_AGENTS;
  const sessions = projectData?.sessions ?? EMPTY_SESSIONS;
  const collapsedAgentIds = useAgentSessionListUiStore((s) => s.collapsedAgentIdsByProject[projectId]);
  const collapsedInitialized = collapsedAgentIds !== undefined;

  const effectiveCollapsedAgentIds = useMemo(() => {
    if (collapsedInitialized || agents.length === 0) return collapsedAgentIds ?? EMPTY_COLLAPSED_AGENT_IDS;
    return new Set(agents.map((agent) => agent.id));
  }, [collapsedInitialized, collapsedAgentIds, agents]);

  useEffect(() => {
    if (collapsedInitialized || agents.length === 0) return;
    setCollapsedAgentIds(projectId, agents.map((agent) => agent.id));
  }, [collapsedInitialized, agents, projectId, setCollapsedAgentIds]);

  useEffect(() => {
    if (!collapsedInitialized) return;
    const validAgentIds = new Set(agents.map((agent) => agent.id));
    const nextCollapsedAgentIds = [...collapsedAgentIds!].filter((id) => validAgentIds.has(id));
    const changed =
      nextCollapsedAgentIds.length !== collapsedAgentIds!.size ||
      nextCollapsedAgentIds.some((id) => !collapsedAgentIds!.has(id));
    if (changed) {
      setCollapsedAgentIds(projectId, nextCollapsedAgentIds);
    }
  }, [collapsedInitialized, agents, collapsedAgentIds, projectId, setCollapsedAgentIds]);

  const handleSelectSession = (session: SessionInfo) => {
    if (floatingSessionId === session.id) return;
    navigate(`/project/${projectId}/chat/${session.id}`);
  };

  const handleNewSession = async (agent: AgentProfile) => {
    const session = await createSession(projectId, client, agent.id);
    if (session) {
      navigate(`/project/${projectId}/chat/${session.id}`);
    }
  };

  const handleDeleteSessionRequest = (session: SessionInfo) => {
    setDeleteSessionTarget(session);
  };

  const performDeleteSession = async () => {
    if (!deleteSessionTarget) return;
    const deletedId = deleteSessionTarget.id;
    setDeleteSessionTarget(null);
    await deleteSession(projectId, client, deletedId);
    if (activeSessionId === deletedId) {
      navigate(`/project/${projectId}`);
    }
  };

  const handleRenameSession = async (session: SessionInfo, title: string) => {
    const ok = await renameSession(projectId, client, session.id, title);
    if (!ok) {
      const message = useProjectDataStore.getState().projects[projectId]?.error || t("agent-session-list.renameFailed");
      toast.error(t("agent-session-list.renameFailed", { message }));
    }
    return ok;
  };

  const handleDeleteAgent = (agent: AgentProfile) => {
    setDeleteTarget(agent);
  };

  const performDeleteAgent = async (agent: AgentProfile) => {
    await deleteAgent(projectId, client, agent.id);
    if (activeSessionId) {
      const deletedSessionBelongsToAgent = projectData?.sessions.some(
        (s) => s.id === activeSessionId && s.agentId === agent.id,
      );
      if (deletedSessionBelongsToAgent) {
        navigate(`/project/${projectId}`);
      }
    }
  };

  const handleCreateAgent = async (slug: string, content: string, themeContent: string) => {
    const ok = await createAgent(projectId, client, slug, content, themeContent);
    if (ok) setShowCreateAgent(false);
  };

  const handleEditAgent = async (agent: AgentProfile) => {
    const [raw, theme] = await Promise.all([
      client.getAgentRaw(agent.id),
      client.getAgentTheme(agent.id),
    ]);
    setEditAgent({ id: agent.id, content: raw, themeContent: theme });
  };

  const handleEditSubmit = async (_slug: string, content: string, themeContent: string) => {
    if (!editAgent) return;
    const ok = await updateAgent(projectId, client, editAgent.id, content, themeContent);
    if (ok) setEditAgent(null);
  };

  return (
    <>
      <SidebarGroup className="px-0 py-0">
        <SidebarGroupLabel className="h-7 px-0 text-[11px] font-semibold tracking-wide uppercase">
          {t("agent-session-list.groupLabel")}
        </SidebarGroupLabel>
        <SidebarGroupAction
          className="top-1 right-0"
          onClick={() => setShowCreateAgent(true)}
          title={t("agent-session-list.createAgentTooltip")}
        >
          <PlusIcon />
        </SidebarGroupAction>
        <SidebarGroupContent>
          <AgentSessionListView
            agents={agents}
            sessions={sessions}
            collapsedAgentIds={effectiveCollapsedAgentIds}
            activeSessionId={activeSessionId}
            floatingSessionId={floatingSessionId}
            onToggleAgentCollapsed={(agentId) => toggleAgentCollapsed(projectId, agentId)}
            onNewSession={handleNewSession}
            onScheduleAgent={setScheduleAgent}
            onEditAgent={handleEditAgent}
            onDeleteAgent={handleDeleteAgent}
            onSelectSession={handleSelectSession}
            onDeleteSession={handleDeleteSessionRequest}
            onRenameSession={handleRenameSession}
            onFloatSession={(s) => {
              dispatchAction("floatSession", { sessionId: s.id }, { navigate, projectId });
            }}
            onCancelFloat={() => {
              dispatchAction("unfloatSession", {}, { navigate, projectId });
            }}
          />
        </SidebarGroupContent>
      </SidebarGroup>
      {showCreateAgent && (
        <AgentDialog
          mode="create"
          client={client}
          onSubmit={handleCreateAgent}
          onCancel={() => setShowCreateAgent(false)}
        />
      )}
      {editAgent && (
        <AgentDialog
          mode="edit"
          initialContent={editAgent.content}
          initialThemeContent={editAgent.themeContent}
          client={client}
          onSubmit={handleEditSubmit}
          onCancel={() => setEditAgent(null)}
        />
      )}
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("file-tree.confirmDeleteTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("agent-session-list.confirmDeleteAgent", { name: deleteTarget?.name ?? "" })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => {
              if (deleteTarget) {
                performDeleteAgent(deleteTarget);
                setDeleteTarget(null);
              }
            }}>
              {t("common.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog open={!!deleteSessionTarget} onOpenChange={(open) => { if (!open) setDeleteSessionTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("session.confirmDeleteTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("session.confirmDeleteDescription", {
                title: deleteSessionTarget?.title ?? t("session.untitled"),
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={performDeleteSession}>
              {t("common.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {scheduleAgent && (
        <ScheduleDialog
          open={!!scheduleAgent}
          onOpenChange={(open) => { if (!open) setScheduleAgent(null); }}
          agentId={scheduleAgent.id}
          projectId={projectId}
          client={client}
        />
      )}
    </>
  );
}
