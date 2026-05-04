import type { AgentProfile } from "../lib/types";

interface AgentListProps {
  agents: AgentProfile[];
  selectedAgent: AgentProfile | null;
  onSelect: (agent: AgentProfile) => void;
}

export function AgentList({ agents, selectedAgent, onSelect }: AgentListProps) {
  if (agents.length === 0) {
    return <p className="agent-list-empty">暂无 Agent 定义</p>;
  }

  return (
    <ul className="agent-list">
      {agents.map((agent) => (
        <li
          key={agent.id}
          className={`agent-item ${selectedAgent?.id === agent.id ? "agent-item-active" : ""}`}
          onClick={() => onSelect(agent)}
        >
          <span className="agent-item-name">{agent.name}</span>
          <span className={`agent-item-type agent-type-${agent.type}`}>
            {agent.type}
          </span>
        </li>
      ))}
    </ul>
  );
}
