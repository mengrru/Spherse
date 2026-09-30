import { useState } from "react";
import { CheckIcon, ChevronRightIcon, CopyIcon } from "lucide-react";
import type { DebugSessionEventContract } from "@spherse/contracts";
import { useI18n } from "@spherse/i18n/react";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "../../components/ui/collapsible";
import { eventBadgeVariant, eventPreview } from "./event-log-display";

interface EventLogRowProps {
  event: DebugSessionEventContract;
}

export function EventLogRow({ event }: EventLogRowProps) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const json = JSON.stringify(event, null, 2);
  const time = new Date(event.time).toLocaleString();

  const handleCopy = () => {
    navigator.clipboard
      .writeText(json)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      })
      .catch(() => {});
  };

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <div className="border-b border-border last:border-b-0">
        <div className="flex items-center gap-1 px-2 py-1.5 hover:bg-muted/50">
          <CollapsibleTrigger className="group flex min-w-0 flex-1 items-center gap-2 text-start">
            <ChevronRightIcon className="size-3.5 shrink-0 text-muted-foreground transition-transform group-data-[panel-open]:rotate-90" />
            <span className="w-8 shrink-0 font-mono text-xs text-muted-foreground">
              {event.seq}
            </span>
            <Badge variant={eventBadgeVariant(event.type)}>{event.type}</Badge>
            <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
              {eventPreview(event)}
            </span>
            <span className="shrink-0 font-mono text-[0.625rem] text-muted-foreground">
              {time}
            </span>
          </CollapsibleTrigger>
          <Button
            variant="ghost"
            size="icon-sm"
            className="shrink-0 text-muted-foreground"
            onClick={handleCopy}
            title={t("debug.eventLogCopy")}
          >
            {copied ? <CheckIcon /> : <CopyIcon />}
          </Button>
        </div>
        <CollapsibleContent>
          <pre className="mx-2 mb-2 max-h-64 overflow-auto rounded-md bg-muted/50 p-3 font-mono text-xs">
            {json}
          </pre>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}
