import { useEffect, useReducer, useRef } from "react";
import type { KeyboardEvent } from "react";
import { Loader2 } from "lucide-react";
import type { SessionInfo } from "../../lib/types";
import { TreeRow } from "../../components/ui/tree-row";
import { Input } from "../../components/ui/input";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "../../components/ui/context-menu";
import { useI18n } from "@spherse/i18n/react";
import { useProjectDataStore } from "../../stores/project-data-store";
import { useProjectCtx } from "../../lib/project-context";
import { useAgentSessionActions } from "./actions-context";

interface SessionRowProps {
  session: SessionInfo;
  active: boolean;
  floating: boolean;
}

function getFallbackTitle(session: SessionInfo) {
  return new Date(session.updatedAt).toLocaleString();
}

type RenameState =
  | { mode: "idle" }
  | { mode: "editing"; draft: string; error: string | null }
  | { mode: "saving"; draft: string; error: string | null };

type RenameAction =
  | { type: "start"; draft: string }
  | { type: "cancel" }
  | { type: "setDraft"; value: string }
  | { type: "setError"; error: string }
  | { type: "beginSave" }
  | { type: "reset" };

function renameReducer(state: RenameState, action: RenameAction): RenameState {
  switch (action.type) {
    case "start":
      return { mode: "editing", draft: action.draft, error: null };
    case "cancel":
      return { mode: "idle" };
    case "setDraft":
      return state.mode === "idle" ? state : { mode: state.mode, draft: action.value, error: null };
    case "setError":
      return state.mode === "idle" ? state : { mode: state.mode, draft: state.draft, error: action.error };
    case "beginSave":
      return state.mode === "editing"
        ? { mode: "saving", draft: state.draft, error: state.error }
        : state;
    case "reset":
      return { mode: "idle" };
  }
}

export function SessionRow({ session, active, floating }: SessionRowProps) {
  const { t } = useI18n();
  const actions = useAgentSessionActions();
  const [state, dispatch] = useReducer(renameReducer, { mode: "idle" } satisfies RenameState);
  const inputRef = useRef<HTMLInputElement>(null);
  const skipBlurRef = useRef(false);
  const fallbackTitle = getFallbackTitle(session);
  const { projectId } = useProjectCtx();
  const isStreaming = useProjectDataStore(
    (s) => !active && (s.projects[projectId]?.streamingSessionIds.has(session.id) ?? false),
  );

  useEffect(() => {
    if (state.mode === "idle") return;
    skipBlurRef.current = true;
    requestAnimationFrame(() => {
      const input = inputRef.current;
      if (!input) {
        skipBlurRef.current = false;
        return;
      }
      input.focus();
      input.select();
      requestAnimationFrame(() => {
        skipBlurRef.current = false;
      });
    });
  }, [state.mode]);

  function startEditing() {
    dispatch({ type: "start", draft: session.title ?? "" });
  }

  function cancelEditing() {
    if (state.mode === "saving") return;
    dispatch({ type: "cancel" });
  }

  async function saveTitle() {
    if (state.mode === "idle") return;
    const title = state.draft.trim();
    if (!title) {
      dispatch({ type: "setError", error: t("agent-session-list.sessionNameRequired") });
      return;
    }
    if (title.length > 80) {
      dispatch({ type: "setError", error: t("agent-session-list.sessionNameTooLong") });
      return;
    }
    if (title === session.title) {
      dispatch({ type: "cancel" });
      return;
    }

    dispatch({ type: "beginSave" });
    await actions.renameSession(session, title);
    dispatch({ type: "reset" });
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      void saveTitle();
    }
    if (e.key === "Escape") {
      e.preventDefault();
      cancelEditing();
    }
  }

  if (state.mode !== "idle") {
    return (
      <div className="group/session-row">
        <div className="pr-6">
          <Input
            ref={inputRef}
            value={state.draft}
            placeholder={fallbackTitle}
            disabled={state.mode === "saving"}
            aria-invalid={state.error ? true : undefined}
            className="h-6 text-xs"
            autoFocus
            onChange={(e) => {
              dispatch({ type: "setDraft", value: e.target.value });
            }}
            onKeyDown={handleKeyDown}
            onBlur={() => {
              if (skipBlurRef.current) return;
              cancelEditing();
            }}
          />
          {state.error && <div className="mt-1 text-xs text-destructive">{state.error}</div>}
        </div>
      </div>
    );
  }

  return (
    <div className="group/session-row" data-session-id={session.id}>
      <ContextMenu>
        <ContextMenuTrigger>
          <TreeRow
            depth={1}
            selected={active}
            onClick={() => actions.selectSession(session)}
          >
            <span className="overflow-hidden text-ellipsis whitespace-nowrap">
              {session.title ?? fallbackTitle}
            </span>
            {isStreaming && (
              <Loader2 className="ml-auto h-3 w-3 shrink-0 animate-spin text-muted-foreground" />
            )}
          </TreeRow>
        </ContextMenuTrigger>
        <ContextMenuContent>
          {floating ? (
            <ContextMenuItem onClick={actions.cancelFloat}>
              {t("agent-session-list.cancelFloat")}
            </ContextMenuItem>
          ) : (
            <ContextMenuItem onClick={() => actions.floatSession(session)}>
              {t("agent-session-list.floatSession")}
            </ContextMenuItem>
          )}
          <ContextMenuItem onClick={startEditing}>
            {t("common.rename")}
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem variant="destructive" onClick={() => actions.deleteSession(session)}>
            {t("common.delete")}
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
    </div>
  );
}
