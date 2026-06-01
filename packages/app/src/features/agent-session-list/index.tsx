import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { AgentDialog } from "../../components/AgentDialog";
import {
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupContent,
  SidebarGroupLabel,
} from "../../components/ui/sidebar";
import type { AgentProfile, SessionInfo } from "../../lib/types";
import { useAppStore } from "../../stores/app-store";
import { useProjectDataStore } from "../../stores/project-data-store";
import { useProjectUiStore } from "../../stores/project-ui-store";
import { AgentSessionListView } from "./AgentSessionListView";
import { PlusIcon } from "lucide-react";

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
  const navigate = useNavigate();
  const project = useAppStore((state) => state.projects.get(projectKey));
  const projectData = useProjectDataStore((state) => state.projects[projectKey]);
  const projectUi = useProjectUiStore((state) => state.projects[projectKey]);
  const createSession = useProjectDataStore((state) => state.createSession);
  const deleteSession = useProjectDataStore((state) => state.deleteSession);
  const createAgent = useProjectDataStore((state) => state.createAgent);
  const updateAgent = useProjectDataStore((state) => state.updateAgent);
  const deleteAgent = useProjectDataStore((state) => state.deleteAgent);
  const toggleAgentCollapsed = useProjectUiStore((state) => state.toggleAgentCollapsed);
  const setCollapsedAgentIds = useProjectUiStore((state) => state.setCollapsedAgentIds);
  const [showCreateAgent, setShowCreateAgent] = useState(false);
  const [editAgent, setEditAgent] = useState<{ id: string; content: string } | null>(null);

  const agents = projectData?.agents ?? [];
  const sessions = projectData?.sessions ?? [];
  const collapsedAgentIds = projectUi?.collapsedAgentIds ?? new Set<string>();

  useEffect(() => {
    const validAgentIds = new Set(agents.map((agent) => agent.id));
    const nextCollapsedAgentIds = collapsedAgentIds.size === 0
      ? agents.slice(1).map((agent) => agent.id)
      : [...collapsedAgentIds].filter((id) => validAgentIds.has(id));
    const changed =
      nextCollapsedAgentIds.length !== collapsedAgentIds.size ||
      nextCollapsedAgentIds.some((id) => !collapsedAgentIds.has(id));
    if (changed) {
      setCollapsedAgentIds(projectKey, nextCollapsedAgentIds);
    }
  }, [agents, collapsedAgentIds, projectKey, setCollapsedAgentIds]);

  const handleSelectSession = (session: SessionInfo) => {
    navigate(`/project/${projectKey}/chat/${session.id}`);
  };

  const handleNewSession = async (agent: AgentProfile) => {
    if (!project) return;
    const session = await createSession(projectKey, project.ctx.client, agent.id);
    if (session) {
      navigate(`/project/${projectKey}/chat/${session.id}`);
    }
  };

  const handleDeleteSession = async (deletedSessionId: string) => {
    if (!project) return;
    await deleteSession(projectKey, project.ctx.client, deletedSessionId);
    if (activeSessionId === deletedSessionId) {
      navigate(`/project/${projectKey}`);
    }
  };

  const handleDeleteAgent = async (agent: AgentProfile) => {
    const ok = window.confirm(`确定要删除 Agent「${agent.name}」吗？该 Agent 下的所有会话也将被移除。`);
    if (!ok) return;
    if (!project) return;
    await deleteAgent(projectKey, project.ctx.client, agent.id);
    if (selectedAgentId === agent.id) {
      navigate(`/project/${projectKey}`);
    }
  };

  const handleCreateAgent = async (filename: string, content: string) => {
    if (!project) return;
    const ok = await createAgent(projectKey, project.ctx.client, filename, content);
    if (ok) setShowCreateAgent(false);
  };

  const handleEditAgent = async (agent: AgentProfile) => {
    if (!project) return;
    const raw = await project.ctx.client.getAgentRaw(agent.id);
    setEditAgent({ id: agent.id, content: raw });
  };

  const handleEditSubmit = async (_filename: string, content: string) => {
    if (!project || !editAgent) return;
    const ok = await updateAgent(projectKey, project.ctx.client, editAgent.id, content);
    if (ok) setEditAgent(null);
  };

  return (
    <>
      <SidebarGroup className="px-0 py-0">
        <SidebarGroupLabel className="h-7 px-0 text-[11px] font-semibold tracking-wide uppercase">
          Agents
        </SidebarGroupLabel>
        <SidebarGroupAction
          className="top-1 right-0"
          onClick={() => setShowCreateAgent(true)}
          title="创建 Agent"
        >
          <PlusIcon />
        </SidebarGroupAction>
        <SidebarGroupContent>
          <AgentSessionListView
            agents={agents}
            sessions={sessions}
            collapsedAgentIds={collapsedAgentIds}
            activeSessionId={activeSessionId}
            onToggleAgentCollapsed={(agentId) => toggleAgentCollapsed(projectKey, agentId)}
            onNewSession={handleNewSession}
            onEditAgent={handleEditAgent}
            onDeleteAgent={handleDeleteAgent}
            onSelectSession={handleSelectSession}
            onDeleteSession={handleDeleteSession}
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
          client={project.ctx.client}
          onSubmit={handleEditSubmit}
          onCancel={() => setEditAgent(null)}
        />
      )}
    </>
  );
}
