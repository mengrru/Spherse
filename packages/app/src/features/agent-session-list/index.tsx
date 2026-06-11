import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { toast } from "sonner";
import { AgentDialog } from "../../components/AgentDialog";
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
import { useAppStore } from "../../stores/app-store";
import { useProjectDataStore } from "../../stores/project-data-store";
import { useProjectUiStore } from "../../stores/project-ui-store";
import { AgentSessionListView } from "./AgentSessionListView";
import { PlusIcon } from "lucide-react";
import { useI18n } from "@spherse/i18n/react";
import { dispatchAction } from "../../ui-sdk";

const EMPTY_AGENTS: AgentProfile[] = [];
const EMPTY_SESSIONS: SessionInfo[] = [];
const EMPTY_COLLAPSED_AGENT_IDS = new Set<string>();

export interface AgentSessionListProps {
  projectKey: string;
  activeSessionId: string | null;
  selectedAgentId: string | null;
}

export function AgentSessionList({
  projectKey,
  activeSessionId,
  selectedAgentId,
}: AgentSessionListProps) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const project = useAppStore((state) => state.projects.get(projectKey));
  const projectData = useProjectDataStore((state) => state.projects[projectKey]);
  const projectUi = useProjectUiStore((state) => state.projects[projectKey]);
  const createSession = useProjectDataStore((state) => state.createSession);
  const deleteSession = useProjectDataStore((state) => state.deleteSession);
  const renameSession = useProjectDataStore((state) => state.renameSession);
  const createAgent = useProjectDataStore((state) => state.createAgent);
  const updateAgent = useProjectDataStore((state) => state.updateAgent);
  const deleteAgent = useProjectDataStore((state) => state.deleteAgent);
  const toggleAgentCollapsed = useProjectUiStore((state) => state.toggleAgentCollapsed);
  const setCollapsedAgentIds = useProjectUiStore((state) => state.setCollapsedAgentIds);
  const floatingSessionId = projectUi?.floatingChat?.sessionId ?? null;
  const [showCreateAgent, setShowCreateAgent] = useState(false);
  const [editAgent, setEditAgent] = useState<{ id: string; content: string; themeContent: string } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AgentProfile | null>(null);
  const [deleteSessionTarget, setDeleteSessionTarget] = useState<SessionInfo | null>(null);

  const agents = projectData?.agents ?? EMPTY_AGENTS;
  const sessions = projectData?.sessions ?? EMPTY_SESSIONS;
  const collapsedAgentIds = projectUi?.collapsedAgentIds ?? EMPTY_COLLAPSED_AGENT_IDS;

  const effectiveCollapsedAgentIds = useMemo(() => {
    if (projectUi != null || agents.length === 0) return collapsedAgentIds;
    return new Set(agents.map((agent) => agent.id));
  }, [projectUi, collapsedAgentIds, agents]);

  useEffect(() => {
    if (projectUi != null || agents.length === 0) return;
    setCollapsedAgentIds(projectKey, agents.map((agent) => agent.id));
  }, [projectUi, agents, projectKey, setCollapsedAgentIds]);

  useEffect(() => {
    if (projectUi == null) return;
    const validAgentIds = new Set(agents.map((agent) => agent.id));
    const nextCollapsedAgentIds = [...collapsedAgentIds].filter((id) => validAgentIds.has(id));
    const changed =
      nextCollapsedAgentIds.length !== collapsedAgentIds.size ||
      nextCollapsedAgentIds.some((id) => !collapsedAgentIds.has(id));
    if (changed) {
      setCollapsedAgentIds(projectKey, nextCollapsedAgentIds);
    }
  }, [projectUi, agents, collapsedAgentIds, projectKey, setCollapsedAgentIds]);

  const handleSelectSession = (session: SessionInfo) => {
    if (floatingSessionId === session.id) return;
    navigate(`/project/${projectKey}/chat/${session.id}`);
  };

  const handleNewSession = async (agent: AgentProfile) => {
    if (!project) return;
    const session = await createSession(projectKey, project.ctx.client, agent.id);
    if (session) {
      navigate(`/project/${projectKey}/chat/${session.id}`);
    }
  };

  const handleDeleteSessionRequest = (session: SessionInfo) => {
    setDeleteSessionTarget(session);
  };

  const performDeleteSession = async () => {
    if (!project || !deleteSessionTarget) return;
    const deletedId = deleteSessionTarget.id;
    setDeleteSessionTarget(null);
    await deleteSession(projectKey, project.ctx.client, deletedId);
    if (activeSessionId === deletedId) {
      navigate(`/project/${projectKey}`);
    }
  };

  const handleRenameSession = async (session: SessionInfo, title: string) => {
    if (!project) return false;
    const ok = await renameSession(projectKey, project.ctx.client, session.id, title);
    if (!ok) {
      const message = useProjectDataStore.getState().projects[projectKey]?.error ?? t("agent-session-list.renameFailed");
      toast.error(t("agent-session-list.renameFailed", { message }));
    }
    return ok;
  };

  const handleDeleteAgent = (agent: AgentProfile) => {
    setDeleteTarget(agent);
  };

  const performDeleteAgent = async (agent: AgentProfile) => {
    if (!project) return;
    await deleteAgent(projectKey, project.ctx.client, agent.id);
    if (selectedAgentId === agent.id) {
      navigate(`/project/${projectKey}`);
    }
  };

  const handleCreateAgent = async (slug: string, content: string, themeContent: string) => {
    if (!project) return;
    const ok = await createAgent(projectKey, project.ctx.client, slug, content, themeContent);
    if (ok) setShowCreateAgent(false);
  };

  const handleEditAgent = async (agent: AgentProfile) => {
    if (!project) return;
    const [raw, theme] = await Promise.all([
      project.ctx.client.getAgentRaw(agent.id),
      project.ctx.client.getAgentTheme(agent.id),
    ]);
    setEditAgent({ id: agent.id, content: raw, themeContent: theme });
  };

  const handleEditSubmit = async (_slug: string, content: string, themeContent: string) => {
    if (!project || !editAgent) return;
    const ok = await updateAgent(projectKey, project.ctx.client, editAgent.id, content, themeContent);
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
            onToggleAgentCollapsed={(agentId) => toggleAgentCollapsed(projectKey, agentId)}
            onNewSession={handleNewSession}
            onEditAgent={handleEditAgent}
            onDeleteAgent={handleDeleteAgent}
            onSelectSession={handleSelectSession}
            onDeleteSession={handleDeleteSessionRequest}
            onRenameSession={handleRenameSession}
            onFloatSession={(s) => {
              dispatchAction("floatSession", { sessionId: s.id }, { navigate, projectKey });
            }}
            onCancelFloat={() => {
              dispatchAction("unfloatSession", {}, { navigate, projectKey });
            }}
          />
        </SidebarGroupContent>
      </SidebarGroup>
      {showCreateAgent && project && (
        <AgentDialog
          mode="create"
          client={project.ctx.client}
          onSubmit={handleCreateAgent}
          onCancel={() => setShowCreateAgent(false)}
        />
      )}
      {editAgent && project && (
        <AgentDialog
          mode="edit"
          initialContent={editAgent.content}
          initialThemeContent={editAgent.themeContent}
          client={project.ctx.client}
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
    </>
  );
}
