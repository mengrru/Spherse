import type { AgentProfile } from "../../lib/types";
import { CollapsibleTrigger } from "../../components/ui/collapsible";
import { TreeRow } from "../../components/ui/tree-row";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "../../components/ui/context-menu";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { ChevronRightIcon, Clock, PlusIcon } from "lucide-react";
import { toast } from "sonner";
import { useI18n } from "@spherse/i18n/react";
import { cn } from "@/lib/utils";
import { useProjectCtx } from "../../context/project-context";
import { useProjectDataStore } from "../../stores/project-data-store";
import { useAgentSessionActions } from "./actions-context";

interface AgentRowProps {
  agent: AgentProfile;
  active?: boolean;
}

export function AgentRow({ agent, active }: AgentRowProps) {
  const { t } = useI18n();
  const actions = useAgentSessionActions();
  const { projectId } = useProjectCtx();
  const hasEnabled = useProjectDataStore(
    (s) => s.projects[projectId]?.hasEnabledTriggersByAgent?.[agent.id] ?? false,
  );
  return (
    <div className="group/agent-row relative" data-agent-id={agent.id}>
      <ContextMenu>
        <ContextMenuTrigger
          render={
            <CollapsibleTrigger render={<TreeRow depth={0} className={cn("group", active && "bg-sidebar-accent")} />} />
          }
        >
          <ChevronRightIcon
            className="size-4 shrink-0 text-sidebar-foreground/70 transition-transform group-data-[panel-open]:rotate-90"
          />
          <span className="overflow-hidden text-ellipsis whitespace-nowrap">
            {agent.name}
          </span>
          {hasEnabled && (
            <Clock
              className="ml-auto h-3 w-3 shrink-0 text-muted-foreground group-hover/agent-row:hidden"
              title={t("agent-trigger.indicatorTooltip")}
              aria-label={t("agent-trigger.indicatorTooltip")}
            />
          )}
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem onClick={() => actions.newSession(agent)}>
            {t("agent-session-list.newSession")}
          </ContextMenuItem>
          <ContextMenuItem onClick={() => actions.editAgent(agent)}>
            {t("common.edit")}
          </ContextMenuItem>
          <ContextMenuItem onClick={() => actions.triggerAgent(agent)}>
            {t("agent-trigger.menuItem")}
            <Badge variant="secondary" className="ml-auto">Beta</Badge>
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem
            onClick={() => {
              navigator.clipboard.writeText(agent.slug).catch(() => {});
              toast.success(t("agent-session-list.agentIdCopied"));
            }}
          >
            {t("agent-session-list.copyAgentId")}
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem variant="destructive" onClick={() => actions.deleteAgent(agent)}>
            {t("common.delete")}
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
      <div className="absolute inset-y-0 end-1 hidden items-center group-hover/agent-row:flex">
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="text-muted-foreground hover:bg-foreground/10 hover:text-foreground"
          title={t("agent-session-list.newSession")}
          aria-label={t("agent-session-list.newSession")}
          onClick={() => actions.newSession(agent)}
        >
          <PlusIcon />
        </Button>
      </div>
    </div>
  );
}
