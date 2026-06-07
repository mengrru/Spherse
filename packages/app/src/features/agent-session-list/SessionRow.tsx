import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
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

interface SessionRowProps {
  session: SessionInfo;
  active: boolean;
  onSelect: (session: SessionInfo) => void;
  onDelete: (sessionId: string) => void;
  onRename: (session: SessionInfo, title: string) => Promise<boolean>;
}

function getFallbackTitle(session: SessionInfo) {
  return new Date(session.updatedAt).toLocaleString();
}

export function SessionRow({ session, active, onSelect, onDelete, onRename }: SessionRowProps) {
  const { t } = useI18n();
  const [editing, setEditing] = useState(false);
  const [draftTitle, setDraftTitle] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const skipBlurRef = useRef(false);
  const fallbackTitle = getFallbackTitle(session);

  useEffect(() => {
    if (!editing) return;
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
  }, [editing]);

  function startEditing() {
    setDraftTitle(session.title ?? "");
    setError(null);
    setEditing(true);
  }

  function cancelEditing() {
    if (saving) return;
    setEditing(false);
    setDraftTitle("");
    setError(null);
  }

  async function saveTitle() {
    const title = draftTitle.trim();
    if (!title) {
      setError(t("agent-session-list.sessionNameRequired"));
      return;
    }
    if (title.length > 80) {
      setError(t("agent-session-list.sessionNameTooLong"));
      return;
    }
    if (title === session.title) {
      cancelEditing();
      return;
    }

    setSaving(true);
    const ok = await onRename(session, title);
    setSaving(false);
    if (ok) {
      setEditing(false);
      setDraftTitle("");
      setError(null);
    } else {
      setEditing(false);
      setDraftTitle("");
      setError(null);
    }
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

  if (editing) {
    return (
      <div className="group/session-row">
        <div className="pr-6">
          <Input
            ref={inputRef}
            value={draftTitle}
            placeholder={fallbackTitle}
            disabled={saving}
            aria-invalid={error ? true : undefined}
            className="h-6 text-xs"
            autoFocus
            onChange={(e) => {
              setDraftTitle(e.target.value);
              setError(null);
            }}
            onKeyDown={handleKeyDown}
            onBlur={() => {
              if (skipBlurRef.current) return;
              cancelEditing();
            }}
          />
          {error && <div className="mt-1 text-xs text-destructive">{error}</div>}
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
            onClick={() => onSelect(session)}
          >
            <span className="overflow-hidden text-ellipsis whitespace-nowrap">
              {session.title ?? fallbackTitle}
            </span>
          </TreeRow>
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem onClick={startEditing}>
            {t("common.rename")}
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem variant="destructive" onClick={() => onDelete(session.id)}>
            {t("common.delete")}
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
    </div>
  );
}
