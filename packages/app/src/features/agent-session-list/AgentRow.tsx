import type { AgentProfile } from "../../lib/types";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../../components/ui/dropdown-menu";
import { SidebarMenuAction, SidebarMenuButton } from "../../components/ui/sidebar";
import { ChevronRightIcon, MoreHorizontalIcon } from "lucide-react";
import { useI18n } from "@spherse/i18n/react";

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
  const { t } = useI18n();
  return (
    <div className="group/agent-row relative">
      <SidebarMenuButton size="sm" onClick={() => onToggleCollapsed(agent.id)}>
        <ChevronRightIcon className={`transition-transform ${collapsed ? "" : "rotate-90"}`} />
        <span>{agent.name}</span>
      </SidebarMenuButton>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <SidebarMenuAction className="md:opacity-0 group-hover/agent-row:opacity-100 focus-visible:opacity-100 aria-expanded:opacity-100 data-popup-open:opacity-100 data-open:opacity-100" />
          }
        >
          <MoreHorizontalIcon />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => onNewSession(agent)}>
            {t("agent-session-list.newSession")}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => onEditAgent(agent)}>
            {t("common.edit")}
          </DropdownMenuItem>
          <DropdownMenuItem variant="destructive" onClick={() => onDeleteAgent(agent)}>
            {t("common.delete")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
