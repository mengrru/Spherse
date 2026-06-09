import type { AgentProfile, SessionInfo } from "../../lib/types";
import {
  Collapsible,
  CollapsibleContent,
} from "../../components/ui/collapsible";
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
  onDeleteSession: (session: SessionInfo) => void;
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
  const isActive = activeSessionId !== null && sessions.some((s) => s.id === activeSessionId);
  return (
    <Collapsible open={!collapsed} onOpenChange={() => onToggleCollapsed(agent.id)}>
      <AgentRow
        agent={agent}
        active={isActive}
        onNewSession={onNewSession}
        onEditAgent={onEditAgent}
        onDeleteAgent={onDeleteAgent}
      />
      <CollapsibleContent className="ml-2">
        <div className="flex flex-col gap-px">
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
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
