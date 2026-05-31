import type { AgentProfile } from "../../lib/types";
import { Button } from "../../components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../../components/ui/dropdown-menu";
import { ChevronDownIcon, MoreHorizontalIcon } from "lucide-react";

interface AgentRowProps {
  agent: AgentProfile;
  collapsed: boolean;
  onToggleCollapsed: (agentId: string) => void;
  onNewSession: (agent: AgentProfile) => void;
  onEditAgent: (agent: AgentProfile) => void;
  onDeleteAgent: (agent: AgentProfile) => void;
}

export function AgentRow({
  agent,
  collapsed,
  onToggleCollapsed,
  onNewSession,
  onEditAgent,
  onDeleteAgent,
}: AgentRowProps) {
  return (
    <div className="group flex items-center gap-1 rounded px-2 py-1.5 hover:bg-muted">
      <Button
        variant="ghost"
        size="icon-xs"
        className="shrink-0 transition-transform"
        style={{ transform: collapsed ? "rotate(-90deg)" : "rotate(0)" }}
        onClick={() => onToggleCollapsed(agent.id)}
      >
        <ChevronDownIcon />
      </Button>
      <span className="text-[13px] font-medium overflow-hidden text-ellipsis whitespace-nowrap flex-1">{agent.name}</span>
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button variant="ghost" size="icon-xs" className="shrink-0 opacity-0 transition-opacity group-hover:opacity-100" />}>
          <MoreHorizontalIcon />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => onNewSession(agent)}>
            新建对话
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => onEditAgent(agent)}>
            编辑
          </DropdownMenuItem>
          <DropdownMenuItem variant="destructive" onClick={() => onDeleteAgent(agent)}>
            删除
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
