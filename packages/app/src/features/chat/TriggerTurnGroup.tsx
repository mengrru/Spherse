import { useState } from "react";
import type { ReactNode } from "react";
import { useI18n } from "@spherse/i18n/react";
import type { TurnGroupItem } from "./model/turn-groups";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "../../components/ui/collapsible";
import { AlertTriangleIcon, ChevronRightIcon } from "lucide-react";

interface TriggerTurnGroupProps {
  items: TurnGroupItem[];
  triggerName?: string;
  hasError: boolean;
  renderItem: (item: TurnGroupItem) => ReactNode;
}

export function TriggerTurnGroup({ items, triggerName, hasError, renderItem }: TriggerTurnGroupProps) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);

  return (
    <div className="flex w-full flex-col">
      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger
          render={
            <Button
              variant="outline"
              size="sm"
              className={`h-auto w-full justify-start gap-1.5 px-3 py-2 text-xs font-normal text-muted-foreground ${
                open ? "rounded-t-lg" : "rounded-lg"
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
            {triggerName !== undefined
              ? t("chat.triggerTurnSummary", { name: triggerName })
              : t("chat.triggerTurnSummaryFallback")}
          </span>
          {hasError && (
            <Badge variant="outline" className="gap-1 border-destructive/40 text-destructive">
              <AlertTriangleIcon className="size-3" />
              {t("chat.triggerTurnErrorBadge")}
            </Badge>
          )}
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="flex flex-col gap-3 rounded-b-lg border border-t-0 border-border p-3">
            {items.map((item) => renderItem(item))}
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
