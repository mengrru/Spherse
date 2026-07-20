import { useEffect, useReducer } from "react";
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
  | { mode: "loaded"; currentTokens: number; contextWindowLimit: number | null }
  | { mode: "error" };

type StatusAction =
  | { type: "loading" }
  | { type: "loaded"; currentTokens: number; contextWindowLimit: number | null }
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
            <div className="flex flex-col gap-1">
              <span className="text-xs text-muted-foreground">{t("session.statusContextTokens")}</span>
              <span className="text-sm font-medium tabular-nums">
                {formatTokens(state.currentTokens)}
                {limit !== null && (
                  <span className="text-muted-foreground">
                    {" / "}
                    {formatTokens(limit)}
                  </span>
                )}
              </span>
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-xs text-muted-foreground">{t("session.statusContextLimit")}</span>
              <span className="text-sm font-medium tabular-nums">
                {limit !== null ? formatTokens(limit) : t("session.statusUnknown")}
              </span>
            </div>
            {ratio !== null && (
              <div className="mt-1 flex items-center gap-2">
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-primary transition-all"
                    style={{ width: `${ratio}%` }}
                  />
                </div>
                <span className="text-xs tabular-nums text-muted-foreground">{ratio}%</span>
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
