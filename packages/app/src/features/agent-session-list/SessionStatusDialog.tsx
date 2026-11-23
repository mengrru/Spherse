import { useEffect, useReducer, type ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { useI18n } from "@spherse/i18n/react";
import type { SessionStatusResponse } from "@spherse/contracts";
import { useProjectCtx } from "../../context/project-context";
import { useApiClient } from "../../lib/use-connection";
import type { SessionInfo } from "../../lib/types";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../../components/ui/dialog";

type StatusState =
  | { mode: "loading" }
  | { mode: "loaded"; status: SessionStatusResponse }
  | { mode: "error" };

type StatusAction =
  | { type: "loading" }
  | { type: "loaded"; status: SessionStatusResponse }
  | { type: "error" };

function statusReducer(_state: StatusState, action: StatusAction): StatusState {
  switch (action.type) {
    case "loading":
      return { mode: "loading" };
    case "loaded":
      return { mode: "loaded", status: action.status };
    case "error":
      return { mode: "error" };
  }
}

function formatNumber(value: number): string {
  return value.toLocaleString();
}

interface SessionStatusDialogProps {
  session: SessionInfo;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function StatusRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs text-muted-foreground">{label}</span>
      {children}
    </div>
  );
}

function TurnTokenCell({ label, value, unknownLabel }: { label: string; value: number | null | undefined; unknownLabel: string }) {
  return (
    <span className="text-sm tabular-nums">
      <span className="text-xs text-muted-foreground">{label}</span>{" "}
      {typeof value === "number" ? formatNumber(value) : unknownLabel}
    </span>
  );
}

export function SessionStatusDialog({ session, open, onOpenChange }: SessionStatusDialogProps) {
  const { t } = useI18n();
  const { projectId } = useProjectCtx();
  const client = useApiClient(projectId);
  const [state, dispatch] = useReducer(statusReducer, { mode: "loading" } satisfies StatusState);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    dispatch({ type: "loading" });
    client
      .getSessionStatus(session.agentId, session.id)
      .then((result) => {
        if (cancelled) return;
        dispatch({ type: "loaded", status: result });
      })
      .catch(() => {
        if (cancelled) return;
        dispatch({ type: "error" });
      });
    return () => {
      cancelled = true;
    };
  }, [open, session.agentId, session.id, client]);

  const status = state.mode === "loaded" ? state.status : null;
  const limit = status ? status.contextWindowLimit : null;
  const ratio =
    status && limit ? Math.min(100, Math.round((status.currentTokens / limit) * 100)) : null;
  const unknown = t("session.statusUnknown");
  const turnCacheRead = status?.turnCacheReadTokens ?? null;
  const turnInput = status?.turnInputTokens ?? null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("session.statusTitle")}</DialogTitle>
          <DialogDescription>{session.title ?? t("session.untitled")}</DialogDescription>
        </DialogHeader>

        {state.mode === "loading" && (
          <div className="flex items-center justify-center py-6 text-muted-foreground">
            <Loader2 className="me-2 h-4 w-4 animate-spin" />
            <span>{t("session.statusLoading")}</span>
          </div>
        )}

        {state.mode === "error" && (
          <div className="py-2 text-sm text-destructive">{t("session.statusLoadFailed")}</div>
        )}

        {state.mode === "loaded" && status && (
          <div className="flex flex-col gap-3">
            <StatusRow label={t("session.statusContextTokens")}>
              <span className="text-sm font-medium tabular-nums">
                {formatNumber(status.currentTokens)}
                {limit !== null && (
                  <span className="text-muted-foreground">
                    {" / "}
                    {formatNumber(limit)}
                  </span>
                )}
              </span>
            </StatusRow>
            <StatusRow label={t("session.statusContextLimit")}>
              <span className="text-sm font-medium tabular-nums">
                {limit !== null ? formatNumber(limit) : unknown}
              </span>
            </StatusRow>
            {ratio !== null && (
              <div className="flex items-center gap-2">
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-primary transition-all"
                    style={{ width: `${ratio}%` }}
                  />
                </div>
                <span className="text-xs tabular-nums text-muted-foreground">{ratio}%</span>
              </div>
            )}
            <StatusRow label={t("session.statusTurnCacheHitRate")}>
              <span className="text-sm font-medium tabular-nums">
                {typeof status.cacheHitRate === "number"
                  ? `${(status.cacheHitRate * 100).toFixed(1)}%`
                  : unknown}
              </span>
              {typeof status.cacheHitRate === "number" &&
                typeof turnCacheRead === "number" &&
                typeof turnInput === "number" && (
                  <span className="text-xs tabular-nums text-muted-foreground">
                    {t("session.statusCacheHitRateDetail", {
                      read: formatNumber(turnCacheRead),
                      total: formatNumber(turnCacheRead + turnInput),
                    })}
                  </span>
                )}
            </StatusRow>
            <StatusRow label={t("session.statusTurnTokens")}>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                <TurnTokenCell label={t("session.statusTurnInput")} value={turnInput} unknownLabel={unknown} />
                <TurnTokenCell label={t("session.statusTurnOutput")} value={status.turnOutputTokens} unknownLabel={unknown} />
                <TurnTokenCell label={t("session.statusTurnCacheRead")} value={turnCacheRead} unknownLabel={unknown} />
                <TurnTokenCell label={t("session.statusTurnCacheWrite")} value={status.turnCacheWriteTokens} unknownLabel={unknown} />
              </div>
            </StatusRow>
            <StatusRow label={t("session.statusUserMessages")}>
              <span className="text-sm font-medium tabular-nums">
                {typeof status.userMessageCount === "number" ? formatNumber(status.userMessageCount) : unknown}
              </span>
            </StatusRow>
            <StatusRow label={t("session.statusTotalMessages")}>
              <span className="text-sm font-medium tabular-nums">
                {typeof status.messageCount === "number" ? formatNumber(status.messageCount) : unknown}
              </span>
            </StatusRow>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
