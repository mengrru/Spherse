import { useEffect, useState } from "react";
import { useI18n } from "@spherse/i18n/react";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "../../components/ui/collapsible";
import { AlertTriangleIcon, ChevronRightIcon, LoaderCircleIcon } from "lucide-react";
import type { ToolItem } from "./model/tool-item";
import { ToolItemView } from "./ToolItemView";

const AUTO_EXPAND_DELAY_MS = 250;

interface ToolProcessSectionProps {
  tools: ToolItem[];
  onNavigateToPath?: (path: string) => void;
}

export function ToolProcessSection({ tools, onNavigateToPath }: ToolProcessSectionProps) {
  const { t } = useI18n();
  const [userOpen, setUserOpen] = useState<boolean | null>(null);
  const hasRunning = tools.some((tool) => tool.status === "running");
  const [delayedHasRunning, setDelayedHasRunning] = useState(false);

  useEffect(() => {
    if (userOpen !== null) return;
    if (!hasRunning) {
      if (delayedHasRunning) setDelayedHasRunning(false);
      return;
    }
    if (delayedHasRunning) return;
    const timer = setTimeout(() => setDelayedHasRunning(true), AUTO_EXPAND_DELAY_MS);
    return () => clearTimeout(timer);
  }, [hasRunning, delayedHasRunning, userOpen]);

  if (tools.length === 0) return null;

  const errorCount = tools.filter((tool) => tool.status === "error").length;
  const open = userOpen ?? delayedHasRunning;

  return (
    <div className="mt-2 border-t border-dashed border-border pt-2" data-chat-tool-process>
      <Collapsible open={open} onOpenChange={setUserOpen}>
        <CollapsibleTrigger
          render={<Button variant="ghost" className="-mx-1 h-auto w-full justify-start gap-1.5 px-1 py-0.5 text-xs font-normal text-muted-foreground" />}
          onClick={() => setUserOpen(!open)}
        >
          <span
            className="inline-flex size-3 items-center justify-center transition-transform"
            style={{ transform: open ? "rotate(90deg)" : "rotate(0deg)" }}
          >
            <ChevronRightIcon className="size-3" />
          </span>
          <span>{t("chat.toolProcess")}</span>
          <span className="text-muted-foreground/70">{t("chat.toolProcessCount", { count: tools.length })}</span>
          {hasRunning && <LoaderCircleIcon className="size-3 animate-spin text-accent" />}
          {errorCount > 0 && (
            <Badge variant="outline" className="gap-1 border-destructive/40 text-destructive">
              <AlertTriangleIcon className="size-3" />
              {t("chat.toolProcessErrorCount", { count: errorCount })}
            </Badge>
          )}
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="mt-0.5">
            {tools.map((tool) => (
              <ToolItemView key={tool.toolCallId} tool={tool} onNavigateToPath={onNavigateToPath} />
            ))}
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
