import type { AgentProfile } from "../lib/types";
import { Badge } from "./ui/badge";

interface AgentListProps {
  agents: AgentProfile[];
  selectedAgent: AgentProfile | null;
  onSelect: (agent: AgentProfile) => void;
}

export function AgentList({ agents, selectedAgent, onSelect }: AgentListProps) {
  if (agents.length === 0) {
    return <p className="text-xs text-muted-foreground">暂无 Agent 定义</p>;
  }

  return (
    <ul className="list-none">
      {agents.map((agent) => (
        <li
          key={agent.id}
          className={`flex cursor-pointer items-center justify-between rounded px-2 py-1.5 transition-colors hover:bg-muted ${selectedAgent?.id === agent.id ? "bg-accent text-accent-foreground" : ""}`}
          onClick={() => onSelect(agent)}
        >
          <span className="text-[13px] font-medium overflow-hidden text-ellipsis whitespace-nowrap">{agent.name}</span>
          <Badge variant="secondary">
            {agent.type}
          </Badge>
        </li>
      ))}
    </ul>
  );
}
