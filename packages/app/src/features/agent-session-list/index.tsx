import { useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { toast } from "sonner";
import {
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupContent,
  SidebarGroupLabel,
} from "../../components/ui/sidebar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../../components/ui/dropdown-menu";
import type { AgentProfile, SessionInfo } from "../../lib/types";
import { useProjectDataStore } from "../../stores/project-data-store";
import { useProjectCtx } from "../../context/project-context";
import { useFloatingSessionId } from "../floating-chat/use-floating-session-id";
import { AgentSessionListView } from "./AgentSessionListView";
import { AgentSessionActionsProvider, type AgentSessionActions } from "./actions-context";
import { useCollapsedAgents } from "./hooks/use-collapsed-agents";
import { AgentSessionDialogs, type DialogState } from "./AgentSessionDialogs";
import {
  buildExportFilename,
  downloadTextFile,
  formatSessionAsPlainText,
} from "./lib/export-session";
import { EllipsisIcon } from "lucide-react";
import { useI18n } from "@spherse/i18n/react";
import { dispatchAction } from "../../ui-sdk";

const EMPTY_AGENTS: AgentProfile[] = [];
const EMPTY_SESSIONS: SessionInfo[] = [];
const EMPTY_SESSION_PAGING: Record<string, { hasMore: boolean; offset: number }> = {};

export function AgentSessionList() {
  const { t } = useI18n();
  const { sessionId: activeSessionId = null } = useParams();
  const navigate = useNavigate();
  const { projectId, client } = useProjectCtx();
  const projectData = useProjectDataStore((state) => state.projects[projectId]);
  const createSession = useProjectDataStore((state) => state.createSession);
  const deleteSession = useProjectDataStore((state) => state.deleteSession);
  const renameSession = useProjectDataStore((state) => state.renameSession);
  const createAgent = useProjectDataStore((state) => state.createAgent);
  const updateAgent = useProjectDataStore((state) => state.updateAgent);
  const deleteAgent = useProjectDataStore((state) => state.deleteAgent);
  const loadMoreSessions = useProjectDataStore((state) => state.loadMoreSessions);
  const floatingSessionId = useFloatingSessionId(projectId);
  const [dialog, setDialog] = useState<DialogState>({ kind: "none" });

  const agents = projectData?.agents ?? EMPTY_AGENTS;
  const sessions = projectData?.sessions ?? EMPTY_SESSIONS;
  const sessionPaging = projectData?.sessionPaging ?? EMPTY_SESSION_PAGING;
  const activeAgentId = useMemo(
    () => (activeSessionId ? sessions.find((s) => s.id === activeSessionId)?.agentId ?? null : null),
    [activeSessionId, sessions],
  );
  const { effectiveCollapsedAgentIds, toggleAgentCollapsed } = useCollapsedAgents(projectId, agents, activeAgentId);

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

  const handleRenameSession = async (session: SessionInfo, title: string) => {
    const ok = await renameSession(projectId, client, session.id, title);
    if (!ok) {
      const message = useProjectDataStore.getState().projects[projectId]?.error || t("agent-session-list.renameFailed");
      toast.error(t("agent-session-list.renameFailed", { message }));
    }
    return ok;
  };

  const performDeleteSession = async (session: SessionInfo) => {
    setDialog({ kind: "none" });
    await deleteSession(projectId, client, session.id);
    if (activeSessionId === session.id) {
      navigate(`/project/${projectId}`);
    }
  };

  const performDeleteAgent = async (agent: AgentProfile) => {
    setDialog({ kind: "none" });
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
    if (ok) setDialog({ kind: "none" });
  };

  const handleEditSubmit = async (_slug: string, content: string, themeContent: string) => {
    if (dialog.kind !== "edit-agent") return;
    const ok = await updateAgent(projectId, client, dialog.id, content, themeContent);
    if (ok) setDialog({ kind: "none" });
  };

  const handleExportSession = async (session: SessionInfo) => {
    try {
      const messages = await client.getSessionMessages(session.agentId, session.id);
      const agent = agents.find((a) => a.id === session.agentId);
      const content = formatSessionAsPlainText(messages, session.title ?? "", agent?.name);
      const filename = buildExportFilename(agent?.slug ?? session.agentId, new Date());
      downloadTextFile(filename, content);
      toast.success(t("agent-session-list.exportSessionDone", { filename }));
    } catch (_) {
      toast.error(t("agent-session-list.exportSessionFailed"));
    }
  };

  const actions: AgentSessionActions = {
    toggleAgentCollapsed,
    newSession: handleNewSession,
    scheduleAgent: (agent) => setDialog({ kind: "schedule", agent }),
    editAgent: (agent) => setDialog({ kind: "edit-agent", id: agent.id }),
    deleteAgent: (agent) => setDialog({ kind: "delete-agent", agent }),
    selectSession: handleSelectSession,
    deleteSession: (session) => setDialog({ kind: "delete-session", session }),
    renameSession: handleRenameSession,
    floatSession: (s) => {
      dispatchAction("floatSession", { sessionId: s.id }, { navigate, projectId });
    },
    cancelFloat: () => {
      dispatchAction("unfloatSession", {}, { navigate, projectId });
    },
    exportSession: handleExportSession,
    showSessionStatus: (session) => setDialog({ kind: "session-status", session }),
  };

  return (
    <>
      <SidebarGroup className="px-0 py-0">
        <SidebarGroupLabel className="h-7 px-0 text-[11px] font-semibold tracking-wide uppercase">
          {t("agent-session-list.groupLabel")}
        </SidebarGroupLabel>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <SidebarGroupAction
                className="top-1 right-0"
                title={t("agent-session-list.createAgentTooltip")}
              />
            }
          >
            <EllipsisIcon />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" side="bottom">
            <DropdownMenuItem onClick={() => setDialog({ kind: "create-agent" })}>
              {t("agent-session-list.createAgentTooltip")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <SidebarGroupContent>
          <AgentSessionActionsProvider actions={actions}>
            <AgentSessionListView
              agents={agents}
              sessions={sessions}
              sessionPaging={sessionPaging}
              collapsedAgentIds={effectiveCollapsedAgentIds}
              activeSessionId={activeSessionId}
              floatingSessionId={floatingSessionId}
              onLoadMore={(agentId) => loadMoreSessions(projectId, client, agentId)}
            />
          </AgentSessionActionsProvider>
        </SidebarGroupContent>
      </SidebarGroup>
      <AgentSessionDialogs
        dialog={dialog}
        projectId={projectId}
        onClose={() => setDialog({ kind: "none" })}
        onCreateAgent={handleCreateAgent}
        onEditAgent={handleEditSubmit}
        onDeleteAgent={performDeleteAgent}
        onDeleteSession={performDeleteSession}
      />
    </>
  );
}
