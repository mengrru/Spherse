import type { AgentProfile } from "../lib/types";

interface AgentListProps {
  agents: AgentProfile[];
  selectedAgent: AgentProfile | null;
  onSelect: (agent: AgentProfile) => void;
}

export function AgentList({ agents, selectedAgent, onSelect }: AgentListProps) {
  if (agents.length === 0) {
    return <p className="text-xs text-[var(--faint)]">暂无 Agent 定义</p>;
  }

  const typeClass: Record<string, string> = {
    creator: "bg-[var(--type-creator-bg)] text-[var(--type-creator-text)]",
    roleplay: "bg-[var(--type-roleplay-bg)] text-[var(--type-roleplay-text)]",
    scheduler: "bg-[var(--type-scheduler-bg)] text-[var(--type-scheduler-text)]",
  };

  return (
    <ul className="list-none">
      {agents.map((agent) => (
        <li
          key={agent.id}
          className={`flex items-center justify-between px-2 py-1.5 rounded cursor-pointer transition-colors hover:bg-[var(--hover)] ${selectedAgent?.id === agent.id ? "bg-[var(--active-bg)]" : ""}`}
          onClick={() => onSelect(agent)}
        >
          <span className="text-[13px] font-medium overflow-hidden text-ellipsis whitespace-nowrap">{agent.name}</span>
          <span className={`text-[10px] px-1.5 py-[1px] rounded uppercase font-semibold ${typeClass[agent.type] ?? ""}`}>
            {agent.type}
          </span>
        </li>
      ))}
    </ul>
  );
}
