import { useState } from "react";
import { useNavigate } from "react-router";
import { AgentDialog } from "../../components/AgentDialog";
import { Button } from "../../components/ui/button";
import type { AgentProfile, SessionInfo } from "../../lib/types";
import { useAppStore } from "../../stores/app-store";
import { useProjectWorkspaceStore } from "../../stores/project-workspace-store";
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
  const workspace = useProjectWorkspaceStore((state) => state.workspaces[projectKey]);
  const refreshAgents = useProjectWorkspaceStore((state) => state.refreshAgents);
  const createSession = useProjectWorkspaceStore((state) => state.createSession);
  const deleteSession = useProjectWorkspaceStore((state) => state.deleteSession);
  const deleteAgent = useProjectWorkspaceStore((state) => state.deleteAgent);
  const setActiveSession = useProjectWorkspaceStore((state) => state.setActiveSession);
  const toggleAgentCollapsed = useProjectWorkspaceStore((state) => state.toggleAgentCollapsed);
  const [showCreateAgent, setShowCreateAgent] = useState(false);
  const [editAgent, setEditAgent] = useState<{ id: string; content: string } | null>(null);

  const agents = workspace?.agents ?? [];
  const sessions = workspace?.sessions ?? [];
  const collapsedAgentIds = workspace?.collapsedAgentIds ?? new Set<string>();

  const handleSelectSession = (session: SessionInfo) => {
    setActiveSession(projectKey, session.id);
    navigate(`/project/${projectKey}/chat/${session.id}`);
  };

  const handleNewSession = async (agent: AgentProfile) => {
    const session = await createSession(projectKey, agent.id);
    if (session) {
      navigate(`/project/${projectKey}/chat/${session.id}`);
    }
  };

  const handleDeleteSession = async (deletedSessionId: string) => {
    await deleteSession(projectKey, deletedSessionId);
    if (activeSessionId === deletedSessionId) {
      navigate(`/project/${projectKey}`);
    }
  };

  const handleDeleteAgent = async (agent: AgentProfile) => {
    const ok = window.confirm(`确定要删除 Agent「${agent.name}」吗？该 Agent 下的所有会话也将被移除。`);
    if (!ok) return;
    await deleteAgent(projectKey, agent.id);
    if (selectedAgentId === agent.id) {
      setActiveSession(projectKey, null);
      navigate(`/project/${projectKey}`);
    }
  };

  const handleCreateAgent = async (filename: string, content: string) => {
    if (!project) return;
    await project.ctx.client.createAgent(filename, content);
    setShowCreateAgent(false);
    await refreshAgents(projectKey);
  };

  const handleEditAgent = async (agent: AgentProfile) => {
    if (!project) return;
    const raw = await project.ctx.client.getAgentRaw(agent.id);
    setEditAgent({ id: agent.id, content: raw });
  };

  const handleEditSubmit = async (_filename: string, content: string) => {
    if (!project || !editAgent) return;
    await project.ctx.client.updateAgent(editAgent.id, content);
    setEditAgent(null);
    await refreshAgents(projectKey);
  };

  return (
    <>
      <div className="flex items-center justify-between mb-2">
        <h3 className="mb-0 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">Agents</h3>
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={() => setShowCreateAgent(true)}
          title="创建 Agent"
        >
          <PlusIcon />
        </Button>
      </div>
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
