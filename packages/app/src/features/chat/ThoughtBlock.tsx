import { useEffect, useState } from "react";
import { useI18n } from "@spherse/i18n/react";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "../../components/ui/collapsible";
import { AlertTriangleIcon, ChevronRightIcon, LoaderCircleIcon } from "lucide-react";
import type { FileChangeCard } from "./types";
import type { ToolItem } from "./model/tool-item";
import { ToolItemView } from "./ToolItemView";
import { FileViewerCard } from "./FileViewerCard";
import { formatMessageTime } from "./lib/format-time";

const AUTO_EXPAND_DELAY_MS = 250;

interface ThoughtBlockProps {
  tools: ToolItem[];
  awaiting?: boolean;
  active?: boolean;
  timestamp?: number;
  showTime?: boolean;
  runChanges?: FileChangeCard[];
  onNavigateToPath?: (path: string) => void;
}

export function ThoughtBlock({
  tools,
  awaiting = false,
  active = false,
  timestamp,
  showTime,
  runChanges,
  onNavigateToPath,
}: ThoughtBlockProps) {
  const { t } = useI18n();
  const [userOpen, setUserOpen] = useState<boolean | null>(null);
  const hasToolRunning = tools.some((tool) => tool.status === "running");
  const [delayedOpen, setDelayedOpen] = useState(false);

  useEffect(() => {
    if (userOpen !== null) return;
    if (!active) {
      if (delayedOpen) setDelayedOpen(false);
      return;
    }
    if (delayedOpen) return;
    if (!hasToolRunning) return;
    const timer = setTimeout(() => setDelayedOpen(true), AUTO_EXPAND_DELAY_MS);
    return () => clearTimeout(timer);
  }, [active, hasToolRunning, delayedOpen, userOpen]);

  if (tools.length === 0 && !awaiting) return null;

  const errorCount = tools.filter((tool) => tool.status === "error").length;
  const open = userOpen ?? delayedOpen;
  const busy = active || awaiting;

  return (
    <div className="flex w-full min-w-0 flex-col gap-1" data-chat-thought>
      <div className="group flex w-full items-start gap-1.5">
        <Collapsible open={open} onOpenChange={setUserOpen} className="min-w-0 flex-1">
          <CollapsibleTrigger
            render={
              <Button
                variant="ghost"
                className="h-auto w-full justify-start gap-1.5 px-1 py-0.5 text-xs font-normal text-muted-foreground"
              />
            }
          >
            <span
              className="inline-flex size-3 items-center justify-center transition-transform"
              style={{ transform: open ? "rotate(90deg)" : "rotate(0deg)" }}
            >
              <ChevronRightIcon className="size-3" />
            </span>
            <span>{busy ? t("chat.thoughtThinking") : t("chat.thoughtProcess")}</span>
            {tools.length > 0 && (
              <span className="text-muted-foreground/70">{t("chat.thoughtProcessCount", { count: tools.length })}</span>
            )}
            {busy && <LoaderCircleIcon className="size-3 animate-spin text-accent" />}
            {errorCount > 0 && (
              <Badge variant="outline" className="gap-1 border-destructive/40 text-destructive">
                <AlertTriangleIcon className="size-3" />
                {t("chat.thoughtProcessErrorCount", { count: errorCount })}
              </Badge>
            )}
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="ml-4 mt-0.5">
              {tools.map((tool) => (
                <ToolItemView key={tool.toolCallId} tool={tool} onNavigateToPath={onNavigateToPath} />
              ))}
            </div>
          </CollapsibleContent>
        </Collapsible>
        {showTime && timestamp && !busy && (
          <time className="pt-0.5 text-[11px] text-muted-foreground whitespace-nowrap opacity-100 md:opacity-0 md:transition-opacity md:group-hover:opacity-100">
            {formatMessageTime(timestamp)}
          </time>
        )}
      </div>
      {runChanges && runChanges.length > 0 && (
        <div className="mt-1">
          {runChanges.map((change) => (
            <FileViewerCard key={change.path} change={change} onNavigateToPath={onNavigateToPath} />
          ))}
        </div>
      )}
    </div>
  );
}
