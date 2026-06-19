import type { AgentProfile } from "../../lib/types";
import { Button } from "../../components/ui/button";
import { CollapsibleTrigger } from "../../components/ui/collapsible";
import { TreeRow } from "../../components/ui/tree-row";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "../../components/ui/dropdown-menu";
import { ChevronRightIcon, MoreHorizontalIcon } from "lucide-react";
import { useI18n } from "@spherse/i18n/react";
import { cn } from "@/lib/utils";
import { useAgentSessionActions } from "./actions-context";

interface AgentRowProps {
  agent: AgentProfile;
  active?: boolean;
}

export function AgentRow({ agent, active }: AgentRowProps) {
  const { t } = useI18n();
  const actions = useAgentSessionActions();
  return (
    <div className="group/agent-row relative">
      <CollapsibleTrigger render={<TreeRow depth={0} className={cn("group pr-8", active && "bg-sidebar-accent")} />}>
        <ChevronRightIcon
          className="size-4 shrink-0 text-sidebar-foreground/70 transition-transform group-data-[panel-open]:rotate-90"
        />
        <span className="overflow-hidden text-ellipsis whitespace-nowrap">
          {agent.name}
        </span>
      </CollapsibleTrigger>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="ghost"
              size="icon"
              className="absolute right-1 top-1/2 -translate-y-1/2 size-6 opacity-0 group-hover/agent-row:opacity-100 focus-visible:opacity-100 aria-expanded:opacity-100"
            />
          }
        >
          <MoreHorizontalIcon className="size-4" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => actions.newSession(agent)}>
            {t("agent-session-list.newSession")}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => actions.editAgent(agent)}>
            {t("common.edit")}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => actions.scheduleAgent(agent)}>
            {t("agent-schedule.menuItem")}
            <DropdownMenuShortcut>Beta</DropdownMenuShortcut>
          </DropdownMenuItem>
          <DropdownMenuItem variant="destructive" onClick={() => actions.deleteAgent(agent)}>
            {t("common.delete")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
