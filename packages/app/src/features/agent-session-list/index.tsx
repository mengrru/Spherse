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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../../components/ui/dropdown-menu";
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
import { useProjectCtx } from "../../context/project-context";
import { useFloatingSessionId } from "../floating-chat/use-floating-session-id";
import { AgentSessionListView } from "./AgentSessionListView";
import { AgentSessionActionsProvider, type AgentSessionActions } from "./actions-context";
import { ScheduleDialog } from "../agent-schedule";
import { PlusIcon } from "lucide-react";
import { useI18n } from "@spherse/i18n/react";
import { dispatchAction } from "../../ui-sdk";

const EMPTY_AGENTS: AgentProfile[] = [];
const EMPTY_SESSIONS: SessionInfo[] = [];
const EMPTY_COLLAPSED_AGENT_IDS = new Set<string>();

type DialogState =
  | { kind: "none" }
  | { kind: "create-agent" }
  | { kind: "edit-agent"; id: string; content: string; themeContent: string }
  | { kind: "delete-agent"; agent: AgentProfile }
  | { kind: "delete-session"; session: SessionInfo }
  | { kind: "schedule"; agent: AgentProfile };

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
  const toggleAgentCollapsed = useAgentSessionListUiStore((state) => state.toggleAgentCollapsed);
  const setCollapsedAgentIds = useAgentSessionListUiStore((state) => state.setCollapsedAgentIds);
  const floatingSessionId = useFloatingSessionId(projectId);
  const [dialog, setDialog] = useState<DialogState>({ kind: "none" });

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

  const handleEditAgent = async (agent: AgentProfile) => {
    const [raw, theme] = await Promise.all([
      client.getAgentRaw(agent.id),
      client.getAgentTheme(agent.id),
    ]);
    setDialog({ kind: "edit-agent", id: agent.id, content: raw, themeContent: theme });
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

  const actions: AgentSessionActions = {
    toggleAgentCollapsed: (agentId) => toggleAgentCollapsed(projectId, agentId),
    newSession: handleNewSession,
    scheduleAgent: (agent) => setDialog({ kind: "schedule", agent }),
    editAgent: handleEditAgent,
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
            <PlusIcon />
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
              collapsedAgentIds={effectiveCollapsedAgentIds}
              activeSessionId={activeSessionId}
              floatingSessionId={floatingSessionId}
            />
          </AgentSessionActionsProvider>
        </SidebarGroupContent>
      </SidebarGroup>
      {dialog.kind === "create-agent" && (
        <AgentDialog
          mode="create"
          onSubmit={handleCreateAgent}
          onCancel={() => setDialog({ kind: "none" })}
        />
      )}
      {dialog.kind === "edit-agent" && (
        <AgentDialog
          mode="edit"
          initialContent={dialog.content}
          initialThemeContent={dialog.themeContent}
          onSubmit={handleEditSubmit}
          onCancel={() => setDialog({ kind: "none" })}
        />
      )}
      <AlertDialog
        open={dialog.kind === "delete-agent"}
        onOpenChange={(open) => { if (!open) setDialog({ kind: "none" }); }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("file-tree.confirmDeleteTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("agent-session-list.confirmDeleteAgent", {
                name: dialog.kind === "delete-agent" ? dialog.agent.name : "",
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => {
              if (dialog.kind === "delete-agent") performDeleteAgent(dialog.agent);
            }}>
              {t("common.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog
        open={dialog.kind === "delete-session"}
        onOpenChange={(open) => { if (!open) setDialog({ kind: "none" }); }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("session.confirmDeleteTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("session.confirmDeleteDescription", {
                title: dialog.kind === "delete-session" ? dialog.session.title ?? t("session.untitled") : "",
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => {
              if (dialog.kind === "delete-session") performDeleteSession(dialog.session);
            }}>
              {t("common.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {dialog.kind === "schedule" && (
        <ScheduleDialog
          open={true}
          onOpenChange={(open) => { if (!open) setDialog({ kind: "none" }); }}
          agentId={dialog.agent.id}
          projectId={projectId}
        />
      )}
    </>
  );
}
