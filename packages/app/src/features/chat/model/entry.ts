import type { ErrorEventCode } from "@spherse/contracts";
import type { ChatAttachment } from "../types";

export type EntryId = string;

interface EntryBase {
  id: EntryId;
  seq?: number;
  streamId?: string;
  time?: number;
}

export interface UserEntry extends EntryBase {
  kind: "user";
  text: string;
  clientId?: string;
  attachments?: ChatAttachment[];
  triggered?: true;
  triggerName?: string;
  optimistic?: boolean;
  sendFailed?: boolean;
}

export interface ToolCallRef {
  toolCallId: string;
  toolName: string;
  args: Record<string, unknown>;
}

export interface EntryError {
  message: string;
  code?: ErrorEventCode;
  retrySuppressed?: boolean;
}

export interface AssistantEntry extends EntryBase {
  kind: "assistant";
  text: string;
  toolCalls: ToolCallRef[];
  streaming?: boolean;
  error?: EntryError;
  stopReason?: string;
}

export interface ControlProjection {
  requestId: string;
  kind: "approval" | "question";
  status: "pending" | "approved" | "rejected" | "answered" | "timeout";
  approved?: boolean;
  answer?: string;
  timedOut?: boolean;
  reason?: string;
}

export interface ToolResultEntry extends EntryBase {
  kind: "tool-result";
  toolCallId: string;
  ownerId?: EntryId;
  toolName?: string;
  args?: Record<string, unknown>;
  result?: unknown;
  partialResult?: unknown;
  details?: unknown;
  isError?: boolean;
  control?: ControlProjection;
}

export interface ErrorEntry extends EntryBase {
  kind: "error";
  message: string;
  code?: ErrorEventCode;
  retrySuppressed?: boolean;
}

export type ChatEntry = UserEntry | AssistantEntry | ToolResultEntry | ErrorEntry;

let transientCounter = 0;

export function nextTransientId(prefix: "s" | "x"): EntryId {
  transientCounter += 1;
  return `${prefix}${transientCounter}`;
}

export function persistedEntryId(seq: number): EntryId {
  return `e${seq}`;
}

export function toolResultEntryId(toolCallId: string): EntryId {
  return `t:${toolCallId}`;
}

export function isAssistantEntry(entry: ChatEntry): entry is AssistantEntry {
  return entry.kind === "assistant";
}

export function isUserEntry(entry: ChatEntry): entry is UserEntry {
  return entry.kind === "user";
}

export function isToolResultEntry(entry: ChatEntry): entry is ToolResultEntry {
  return entry.kind === "tool-result";
}

export function isErrorEntry(entry: ChatEntry): entry is ErrorEntry {
  return entry.kind === "error";
}

export function findOptimisticUserIndex(
  entries: ChatEntry[],
  match: { clientId?: string; text?: string },
): number {
  if (match.clientId !== undefined) {
    const index = entries.findIndex(
      (entry) => entry.kind === "user" && entry.optimistic === true && entry.clientId === match.clientId,
    );
    if (index >= 0) return index;
  }
  if (!match.text) return -1;
  const matches = entries
    .map((entry, index) => ({ entry, index }))
    .filter(({ entry }) => entry.kind === "user" && entry.optimistic === true && entry.text === match.text);
  return matches.length === 1 ? matches[0].index : -1;
}
