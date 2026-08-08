import type { TriggerEntry } from "../../lib/types";

export type TriggerType = "time" | "event";

export type TriggerSessionMode = "new_session" | "existing_session" | "reusable_session";

export interface TriggerDraft {
  id: string;
  type: TriggerType;
  name: string;
  cron: string;
  eventName: string;
  message: string;
  sessionMode: TriggerSessionMode;
  targetSessionId: string;
  boundSessionId?: string;
  notify: boolean;
  notificationMessage: string;
}

export function emptyTriggerDraft(): TriggerDraft {
  return {
    id: crypto.randomUUID(),
    type: "time",
    name: "",
    cron: "",
    eventName: "",
    message: "",
    sessionMode: "reusable_session",
    targetSessionId: "",
    notify: false,
    notificationMessage: "",
  };
}

export function entryToDraft(entry: TriggerEntry): TriggerDraft {
  return {
    id: entry.id,
    type: entry.type,
    name: entry.name ?? "",
    cron: entry.cron ?? "",
    eventName: entry.eventName ?? "",
    message: entry.message,
    sessionMode: entry.mode,
    targetSessionId: entry.targetSessionId ?? "",
    boundSessionId: entry.boundSessionId,
    notify: entry.notify,
    notificationMessage: entry.notificationMessage ?? "",
  };
}

export interface TriggerDraftData {
  name?: string;
  type: TriggerType;
  cron?: string;
  eventName?: string;
  mode: TriggerSessionMode;
  targetSessionId?: string;
  message: string;
  notify: boolean;
  notificationMessage?: string;
}

export function draftToTriggerData(draft: TriggerDraft): TriggerDraftData | null {
  const message = draft.message.trim();
  if (!message) return null;

  if (draft.type === "time") {
    if (!draft.cron.trim()) return null;
  } else {
    if (!draft.eventName.trim()) return null;
  }

  if (draft.sessionMode === "existing_session" && !draft.targetSessionId.trim()) return null;

  const name = draft.name.trim();
  const notificationMessage =
    draft.notify && draft.notificationMessage.trim() ? draft.notificationMessage.trim() : undefined;
  const targetSessionId =
    draft.sessionMode === "existing_session" ? draft.targetSessionId.trim() : undefined;

  return {
    ...(name ? { name } : {}),
    type: draft.type,
    ...(draft.type === "time"
      ? { cron: draft.cron.trim() }
      : { eventName: draft.eventName.trim() }),
    mode: draft.sessionMode,
    ...(targetSessionId ? { targetSessionId } : {}),
    message,
    notify: draft.notify,
    ...(notificationMessage ? { notificationMessage } : {}),
  };
}
