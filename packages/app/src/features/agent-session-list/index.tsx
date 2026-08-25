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
import type { AgentSummary, SessionInfo } from "../../lib/types";
import { useProjectCtx } from "../../context/project-context";
import { useApiClient } from "../../lib/use-connection";
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
import { useFeature } from "../../lib/use-feature";
import { useHostBridge } from "../../context/host-bridge-context";
import {
  createProjectAgent,
  createProjectSession,
  deleteProjectAgent,
  deleteProjectSession,
  loadMoreProjectSessions,
  renameProjectSession,
  updateProjectAgent,
  useProjectCatalog,
} from "../../queries/project";

export function AgentSessionList() {
  const { t } = useI18n();
  const { sessionId: activeSessionId = null } = useParams();
  const navigate = useNavigate();
  const { kind: hostKind } = useHostBridge();
  const { projectId } = useProjectCtx();
  const client = useApiClient(projectId);
  const agentDialogEnabled = useFeature("agent-dialog");
  const { agents, sessions, sessionPaging } = useProjectCatalog(projectId, client);
  const floatingSessionId = useFloatingSessionId(projectId);
  const [dialog, setDialog] = useState<DialogState>({ kind: "none" });

  const activeAgentId = useMemo(
    () => (activeSessionId ? sessions.find((s) => s.id === activeSessionId)?.agentId ?? null : null),
    [activeSessionId, sessions],
  );
  const { effectiveCollapsedAgentIds, toggleAgentCollapsed } = useCollapsedAgents(projectId, agents, activeAgentId);

  const handleSelectSession = (session: SessionInfo) => {
    if (floatingSessionId === session.id) return;
    navigate(`/project/${projectId}/chat/${session.id}`);
  };

  const handleNewSession = async (agent: AgentSummary) => {
    const session = await createProjectSession(projectId, client, agent.id).catch(() => null);
    if (session) {
      navigate(`/project/${projectId}/chat/${session.id}`);
    }
  };

  const handleRenameSession = async (session: SessionInfo, title: string) => {
    const ok = await renameProjectSession(projectId, client, session, title).then(() => true).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : t("agent-session-list.renameFailed");
      toast.error(t("agent-session-list.renameFailed", { message }));
      return false;
    });
    return ok;
  };

  const performDeleteSession = async (session: SessionInfo) => {
    setDialog({ kind: "none" });
    await deleteProjectSession(projectId, client, session).catch(() => undefined);
    if (activeSessionId === session.id) {
      navigate(`/project/${projectId}`);
    }
  };

  const performDeleteAgent = async (agent: AgentSummary) => {
    setDialog({ kind: "none" });
    await deleteProjectAgent(projectId, client, agent.id).catch(() => undefined);
    if (activeSessionId) {
      const deletedSessionBelongsToAgent = sessions.some(
        (s) => s.id === activeSessionId && s.agentId === agent.id,
      );
      if (deletedSessionBelongsToAgent) {
        navigate(`/project/${projectId}`);
      }
    }
  };

  const handleCreateAgent = async (slugBase: string, content: string, themeContent: string) => {
    const ok = await createProjectAgent(projectId, client, slugBase, content, themeContent).then(() => true).catch(() => false);
    if (ok) setDialog({ kind: "none" });
  };

  const handleEditSubmit = async (_slug: string, content: string, themeContent: string) => {
    if (dialog.kind !== "edit-agent") return;
    const ok = await updateProjectAgent(projectId, client, dialog.id, content, themeContent).then(() => true).catch(() => false);
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
    triggerAgent: (agent) => setDialog({ kind: "trigger", agent }),
    mcpAgent: (agent) => setDialog({ kind: "mcp", agent }),
    editAgent: (agent) => setDialog({ kind: "edit-agent", id: agent.id }),
    deleteAgent: (agent) => setDialog({ kind: "delete-agent", agent }),
    selectSession: handleSelectSession,
    deleteSession: (session) => setDialog({ kind: "delete-session", session }),
    renameSession: handleRenameSession,
    floatSession: (s) => {
      dispatchAction("floatSession", { sessionId: s.id }, { navigate, projectId, hostKind });
    },
    cancelFloat: () => {
      dispatchAction("unfloatSession", {}, { navigate, projectId, hostKind });
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
        {agentDialogEnabled && (
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
        )}
        <SidebarGroupContent>
          <AgentSessionActionsProvider actions={actions}>
            <AgentSessionListView
              agents={agents}
              sessions={sessions}
              sessionPaging={sessionPaging}
              collapsedAgentIds={effectiveCollapsedAgentIds}
              activeSessionId={activeSessionId}
              floatingSessionId={floatingSessionId}
              onLoadMore={(agentId) => loadMoreProjectSessions(projectId, client, agentId)}
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
