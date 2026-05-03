import type { AgentDefinition } from "../lib/types";

interface AgentListProps {
  agents: AgentDefinition[];
  selectedAgent: AgentDefinition | null;
  onSelect: (agent: AgentDefinition) => void;
}

export function AgentList({ agents, selectedAgent, onSelect }: AgentListProps) {
  if (agents.length === 0) {
    return <p className="agent-list-empty">暂无 Agent 定义</p>;
  }

  return (
    <ul className="agent-list">
      {agents.map((agent) => (
        <li
          key={agent.name}
          className={`agent-item ${selectedAgent?.name === agent.name ? "agent-item-active" : ""}`}
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
