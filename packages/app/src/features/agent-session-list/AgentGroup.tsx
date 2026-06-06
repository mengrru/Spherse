import type { AgentProfile, SessionInfo } from "../../lib/types";
import { SidebarMenuItem, SidebarMenuSub } from "../../components/ui/sidebar";
import { AgentRow } from "./AgentRow";
import { SessionRow } from "./SessionRow";

interface AgentGroupProps {
  agent: AgentProfile;
  sessions: SessionInfo[];
  collapsed: boolean;
  activeSessionId: string | null;
  onToggleCollapsed: (agentId: string) => void;
  onNewSession: (agent: AgentProfile) => void;
  onEditAgent: (agent: AgentProfile) => void;
  onDeleteAgent: (agent: AgentProfile) => void;
  onSelectSession: (session: SessionInfo) => void;
  onDeleteSession: (sessionId: string) => void;
  onRenameSession: (session: SessionInfo, title: string) => Promise<boolean>;
}

export function AgentGroup({
  agent,
  sessions,
  collapsed,
  activeSessionId,
  onToggleCollapsed,
  onNewSession,
  onEditAgent,
  onDeleteAgent,
  onSelectSession,
  onDeleteSession,
  onRenameSession,
}: AgentGroupProps) {
  return (
    <SidebarMenuItem>
      <AgentRow
        agent={agent}
        collapsed={collapsed}
        onToggleCollapsed={onToggleCollapsed}
        onNewSession={onNewSession}
        onEditAgent={onEditAgent}
        onDeleteAgent={onDeleteAgent}
      />
      {!collapsed && sessions.length > 0 && (
        <SidebarMenuSub>
          {sessions.map((session) => (
            <SessionRow
              key={session.id}
              session={session}
              active={activeSessionId === session.id}
               onSelect={onSelectSession}
               onDelete={onDeleteSession}
               onRename={onRenameSession}
             />
          ))}
        </SidebarMenuSub>
      )}
    </SidebarMenuItem>
  );
}
