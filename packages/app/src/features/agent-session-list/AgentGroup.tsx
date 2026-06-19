import type { AgentProfile, SessionInfo } from "../../lib/types";
import {
  Collapsible,
  CollapsibleContent,
} from "../../components/ui/collapsible";
import { AgentRow } from "./AgentRow";
import { SessionRow } from "./SessionRow";
import { useAgentSessionActions } from "./actions-context";

interface AgentGroupProps {
  agent: AgentProfile;
  sessions: SessionInfo[];
  collapsed: boolean;
  activeSessionId: string | null;
  floatingSessionId: string | null;
}

export function AgentGroup({
  agent,
  sessions,
  collapsed,
  activeSessionId,
  floatingSessionId,
}: AgentGroupProps) {
  const actions = useAgentSessionActions();
  const isActive = activeSessionId !== null && sessions.some((s) => s.id === activeSessionId);
  return (
    <Collapsible open={!collapsed} onOpenChange={() => actions.toggleAgentCollapsed(agent.id)}>
      <AgentRow agent={agent} active={isActive} />
      <CollapsibleContent className="ml-2">
        <div className="flex flex-col gap-px">
          {sessions.map((session) => (
            <SessionRow
              key={session.id}
              session={session}
              active={activeSessionId === session.id || session.id === floatingSessionId}
              floating={session.id === floatingSessionId}
            />
          ))}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
