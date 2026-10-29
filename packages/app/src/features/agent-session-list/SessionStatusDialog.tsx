import { useEffect, useReducer, type ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { useI18n } from "@spherse/i18n/react";
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
  | {
      mode: "loaded";
      currentTokens: number;
      contextWindowLimit: number | null;
      cacheHitRate: number | null;
      turnInputTokens: number;
      turnCacheReadTokens: number;
      turnCacheWriteTokens: number;
      turnOutputTokens: number;
      userMessageCount: number;
      messageCount: number;
    }
  | { mode: "error" };

type StatusAction =
  | { type: "loading" }
  | {
      type: "loaded";
      currentTokens: number;
      contextWindowLimit: number | null;
      cacheHitRate: number | null;
      turnInputTokens: number;
      turnCacheReadTokens: number;
      turnCacheWriteTokens: number;
      turnOutputTokens: number;
      userMessageCount: number;
      messageCount: number;
    }
  | { type: "error" };

function statusReducer(_state: StatusState, action: StatusAction): StatusState {
  switch (action.type) {
    case "loading":
      return { mode: "loading" };
    case "loaded":
      return {
        mode: "loaded",
        currentTokens: action.currentTokens,
        contextWindowLimit: action.contextWindowLimit,
        cacheHitRate: action.cacheHitRate,
        turnInputTokens: action.turnInputTokens,
        turnCacheReadTokens: action.turnCacheReadTokens,
        turnCacheWriteTokens: action.turnCacheWriteTokens,
        turnOutputTokens: action.turnOutputTokens,
        userMessageCount: action.userMessageCount,
        messageCount: action.messageCount,
      };
    case "error":
      return { mode: "error" };
  }
}

function formatTokens(value: number): string {
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
        dispatch({
          type: "loaded",
          currentTokens: result.currentTokens,
          contextWindowLimit: result.contextWindowLimit,
          cacheHitRate: result.cacheHitRate,
          turnInputTokens: result.turnInputTokens,
          turnCacheReadTokens: result.turnCacheReadTokens,
          turnCacheWriteTokens: result.turnCacheWriteTokens,
          turnOutputTokens: result.turnOutputTokens,
          userMessageCount: result.userMessageCount,
          messageCount: result.messageCount,
        });
      })
      .catch(() => {
        if (cancelled) return;
        dispatch({ type: "error" });
      });
    return () => {
      cancelled = true;
    };
  }, [open, session.agentId, session.id, client]);

  const limit = state.mode === "loaded" ? state.contextWindowLimit : null;
  const ratio =
    state.mode === "loaded" && limit ? Math.min(100, Math.round((state.currentTokens / limit) * 100)) : null;

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

        {state.mode === "loaded" && (
          <div className="flex flex-col gap-3">
            <StatusRow label={t("session.statusContextTokens")}>
              <span className="text-sm font-medium tabular-nums">
                {formatTokens(state.currentTokens)}
                {limit !== null && (
                  <span className="text-muted-foreground">
                    {" / "}
                    {formatTokens(limit)}
                  </span>
                )}
              </span>
            </StatusRow>
            <StatusRow label={t("session.statusContextLimit")}>
              <span className="text-sm font-medium tabular-nums">
                {limit !== null ? formatTokens(limit) : t("session.statusUnknown")}
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
                {state.cacheHitRate !== null
                  ? `${(state.cacheHitRate * 100).toFixed(1)}%`
                  : t("session.statusUnknown")}
              </span>
              {state.cacheHitRate !== null && (
                <span className="text-xs tabular-nums text-muted-foreground">
                  {t("session.statusCacheHitRateDetail", {
                    read: formatTokens(state.turnCacheReadTokens),
                    total: formatTokens(state.turnCacheReadTokens + state.turnInputTokens),
                  })}
                </span>
              )}
            </StatusRow>
            <StatusRow label={t("session.statusTurnTokens")}>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                <span className="text-sm tabular-nums">
                  <span className="text-xs text-muted-foreground">{t("session.statusTurnInput")}</span>{" "}
                  {formatTokens(state.turnInputTokens)}
                </span>
                <span className="text-sm tabular-nums">
                  <span className="text-xs text-muted-foreground">{t("session.statusTurnOutput")}</span>{" "}
                  {formatTokens(state.turnOutputTokens)}
                </span>
                <span className="text-sm tabular-nums">
                  <span className="text-xs text-muted-foreground">{t("session.statusTurnCacheRead")}</span>{" "}
                  {formatTokens(state.turnCacheReadTokens)}
                </span>
                <span className="text-sm tabular-nums">
                  <span className="text-xs text-muted-foreground">{t("session.statusTurnCacheWrite")}</span>{" "}
                  {formatTokens(state.turnCacheWriteTokens)}
                </span>
              </div>
            </StatusRow>
            <StatusRow label={t("session.statusUserMessages")}>
              <span className="text-sm font-medium tabular-nums">
                {formatTokens(state.userMessageCount)}
              </span>
            </StatusRow>
            <StatusRow label={t("session.statusTotalMessages")}>
              <span className="text-sm font-medium tabular-nums">
                {formatTokens(state.messageCount)}
              </span>
            </StatusRow>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
