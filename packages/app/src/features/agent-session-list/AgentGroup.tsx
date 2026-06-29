import type { AgentProfile, SessionInfo } from "../../lib/types";
import {
  Collapsible,
  CollapsibleContent,
} from "../../components/ui/collapsible";
import { Button } from "../../components/ui/button";
import { useI18n } from "@spherse/i18n/react";
import { AgentRow } from "./AgentRow";
import { SessionRow } from "./SessionRow";
import { useAgentSessionActions } from "./actions-context";

interface AgentGroupProps {
  agent: AgentProfile;
  sessions: SessionInfo[];
  collapsed: boolean;
  activeSessionId: string | null;
  floatingSessionId: string | null;
  hasMore?: boolean;
  loadingMore?: boolean;
  onLoadMore?: () => void;
}

export function AgentGroup({
  agent,
  sessions,
  collapsed,
  activeSessionId,
  floatingSessionId,
  hasMore,
  loadingMore,
  onLoadMore,
}: AgentGroupProps) {
  const { t } = useI18n();
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
          {hasMore && (
            <Button variant="ghost" size="sm" className="ps-6 justify-start" disabled={loadingMore} onClick={onLoadMore}>
              {loadingMore ? t("common.loading") : t("agent-session-list.loadMore")}
            </Button>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
