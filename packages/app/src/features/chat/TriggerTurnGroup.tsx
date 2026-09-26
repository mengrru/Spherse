import { Fragment, useEffect, useState, type ReactNode } from "react";
import { useI18n } from "@spherse/i18n/react";
import type { Bubble, MessageGroup } from "./model/message-group";
import type { UserEntry } from "./model/entry";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "../../components/ui/collapsible";
import { AlertTriangleIcon, ChevronRightIcon, LoaderCircleIcon } from "lucide-react";

interface TriggerTurnGroupProps {
  group: MessageGroup;
  running?: boolean;
  forceOpen?: boolean;
  renderUser: (user: UserEntry) => ReactNode;
  renderBubble: (bubble: Bubble, index: number) => ReactNode;
}

export function TriggerTurnGroup({ group, running = false, forceOpen = false, renderUser, renderBubble }: TriggerTurnGroupProps) {
  const { t } = useI18n();
  const [userOpen, setUserOpen] = useState(false);

  useEffect(() => {
    if (!forceOpen) return;
    return () => {
      setUserOpen(true);
    };
  }, [forceOpen]);

  const open = forceOpen || userOpen;

  return (
    <div className="flex w-full flex-col">
      <Collapsible open={open} onOpenChange={setUserOpen}>
        <CollapsibleTrigger
          render={
            <Button
              variant="outline"
              size="sm"
              className={`h-auto w-full justify-start gap-1.5 px-3 py-2 text-xs font-normal text-muted-foreground ${
                open ? "rounded-t-lg rounded-b-none" : "rounded-lg"
              }`}
              data-chat-turn-collapse
            />
          }
        >
          <span
            className="inline-flex size-3 shrink-0 items-center justify-center transition-transform"
            style={{ transform: open ? "rotate(90deg)" : "rotate(0deg)" }}
          >
            <ChevronRightIcon className="size-3" />
          </span>
          <span className="truncate">
            {group.triggerName !== undefined
              ? t("chat.triggerTurnSummary", { name: group.triggerName })
              : t("chat.triggerTurnSummaryFallback")}
          </span>
          {running && (
            <Badge variant="outline" className="gap-1 text-muted-foreground">
              <LoaderCircleIcon className="size-3 animate-spin" />
              {t("chat.triggerTurnRunningBadge")}
            </Badge>
          )}
          {group.hasError && (
            <Badge variant="outline" className="gap-1 border-destructive/40 text-destructive">
              <AlertTriangleIcon className="size-3" />
              {t("chat.triggerTurnErrorBadge")}
            </Badge>
          )}
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="flex flex-col gap-3 rounded-b-lg border border-t-0 border-border p-3">
            {group.user && renderUser(group.user)}
            {group.bubbles.map((bubble, index) => (
              <Fragment key={bubble.id}>{renderBubble(bubble, index)}</Fragment>
            ))}
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
