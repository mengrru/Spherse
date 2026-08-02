import { useState } from "react";
import { CheckIcon, XIcon, TerminalIcon, ClockIcon, AlertTriangleIcon } from "lucide-react";
import { useI18n } from "@spherse/i18n/react";
import type { CommandCard } from "./types";
import { Button } from "../../components/ui/button";

interface CommandCardRendererProps {
  card: CommandCard;
  onRespondApproval?: (requestId: string, approved: boolean) => void;
}

export function CommandCardRenderer({ card, onRespondApproval }: CommandCardRendererProps) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(false);

  if (card.status === "pending_approval") {
    return (
      <div className="my-2 overflow-hidden rounded-lg border border-warning/50 bg-warning/5">
        <div className="flex items-center gap-1.5 border-b border-border px-3 py-1.5 text-xs font-medium text-warning">
          <AlertTriangleIcon className="size-3.5" />
          {t("command.pendingApproval")}
        </div>
        <div className="px-3 py-2">
          <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-all rounded bg-muted p-2 font-mono text-xs text-foreground">
            {card.command}
          </pre>
          {card.cwd ? (
            <div className="mt-1 text-[11px] text-muted-foreground">{t("command.cwd")}: {card.cwd}</div>
          ) : null}
          <p className="mt-2 text-[11px] text-muted-foreground">{t("command.warning")}</p>
          <div className="mt-2 flex justify-end gap-2">
            <Button size="sm" variant="default" onClick={() => card.requestId && onRespondApproval?.(card.requestId, false)}>
              <XIcon className="size-3.5" />
              {t("command.reject")}
            </Button>
            <Button size="sm" variant="destructive" onClick={() => card.requestId && onRespondApproval?.(card.requestId, true)}>
              <CheckIcon className="size-3.5" />
              {t("command.approve")}
            </Button>
          </div>
        </div>
      </div>
    );
  }

  const isError = card.status === "error";

  return (
    <div className="my-2 overflow-hidden rounded-lg border border-border">
      <div className="flex items-center justify-between gap-2 border-b border-border bg-muted/50 px-3 py-1.5">
        <div className="flex min-w-0 items-start gap-1.5 text-xs font-medium text-muted-foreground">
          <TerminalIcon className="size-3.5 mt-0.5 shrink-0" />
          <span
            className={`font-mono ${expanded ? "block max-h-40 overflow-auto whitespace-pre-wrap break-all" : "cursor-pointer truncate"}`}
            onClick={expanded ? undefined : () => setExpanded(true)}
            title={expanded ? undefined : card.command}
          >
            {card.command}
          </span>
          {expanded ? (
            <button
              type="button"
              className="shrink-0 text-muted-foreground hover:text-foreground"
              onClick={() => setExpanded(false)}
            >
              <XIcon className="size-3" />
            </button>
          ) : null}
        </div>
        <div className="flex w-16 shrink-0 flex-col items-end gap-1 text-[11px]">
          {card.rejected ? (
            <span className="rounded bg-muted px-1.5 py-1 leading-none text-muted-foreground">{t("command.rejected")}</span>
          ) : null}
          {card.timedOut ? (
            <span className="rounded bg-destructive/15 px-1.5 py-1 leading-none text-destructive">{t("command.timedOut")}</span>
          ) : null}
          {card.aborted ? (
            <span className="rounded bg-muted px-1.5 py-1 leading-none text-muted-foreground">{t("command.aborted")}</span>
          ) : null}
          {card.exitCode !== undefined && !card.timedOut && !card.aborted ? (
            <span className={`rounded px-1.5 py-1 leading-none font-mono ${isError ? "bg-destructive/15 text-destructive" : "bg-success/15 text-success"}`}>
              {t("command.exitCode", { code: card.exitCode })}
            </span>
          ) : null}
          {card.durationMs !== undefined ? (
            <span className="flex items-center gap-0.5 text-muted-foreground">
              <ClockIcon className="size-3" />
              {formatDuration(card.durationMs)}
            </span>
          ) : null}
        </div>
      </div>
      <div className="max-h-64 overflow-auto px-3 py-2 font-mono text-xs">
        {card.stdout ? <pre className="whitespace-pre-wrap break-all text-foreground">{card.stdout}</pre> : null}
        {card.stderr ? <pre className="whitespace-pre-wrap break-all text-destructive">{card.stderr}</pre> : null}
        {!card.stdout && !card.stderr ? (
          <span className="text-muted-foreground">{t("command.noOutput")}</span>
        ) : null}
      </div>
    </div>
  );
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}
