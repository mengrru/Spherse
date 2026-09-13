import type { SessionMessagesPageResponse } from "@spherse/contracts";
import {
  isAssistantMessage,
  isToolResultMessage,
  isUserMessage,
} from "./agent-event-parse";
import { extractMessageText, extractToolCalls } from "./chat-tool-projection";
import { classifyErrorMessageString } from "./classify-error";
import {
  findOptimisticUserIndex,
  persistedEntryId,
  type AssistantEntry,
  type ChatEntry,
  type EntryId,
  type ToolCallRef,
  type ToolResultEntry,
  type UserEntry,
} from "./entry";
import type { ChatEntryState } from "./entry-reducer";
import type { ChatAttachment } from "../types";

export type HistoryPageEntry = SessionMessagesPageResponse["entries"][number];
export type HistoryPageMode = "latest" | "loadMore";

export function parseHistoryEntries(pageEntries: HistoryPageEntry[]): ChatEntry[] {
  const parsed: ChatEntry[] = [];
  for (const entry of pageEntries) {
    const { id, message } = entry;
    if (isUserMessage(message)) {
      const rawAttachments = (message as { _attachments?: unknown })._attachments;
      const user: UserEntry = {
        kind: "user",
        id: persistedEntryId(id),
        seq: id,
        text: extractMessageText(message.content),
        ...(Array.isArray(rawAttachments) && rawAttachments.length > 0
          ? { attachments: rawAttachments as ChatAttachment[] }
          : {}),
        ...(entry.source === "triggered" ? { triggered: true as const } : {}),
        ...(entry.source === "triggered" && entry.triggerName !== undefined
          ? { triggerName: entry.triggerName }
          : {}),
        ...(message.timestamp !== undefined ? { time: message.timestamp } : {}),
      };
      parsed.push(user);
      continue;
    }
    if (isAssistantMessage(message)) {
      const toolCalls: ToolCallRef[] = (extractToolCalls(message) ?? []).map((toolCall) => ({
        toolCallId: toolCall.toolCallId,
        toolName: toolCall.toolName,
        args: toolCall.args,
      }));
      const isError = message.stopReason === "error";
      const errorMessage = message.errorMessage ?? "Unknown error";
      const assistant: AssistantEntry = {
        kind: "assistant",
        id: persistedEntryId(id),
        seq: id,
        text: extractMessageText(message.content),
        toolCalls,
        ...(message.stopReason !== undefined ? { stopReason: message.stopReason } : {}),
        ...(isError
          ? { error: { message: errorMessage, code: classifyErrorMessageString(errorMessage) } }
          : {}),
        ...(message.timestamp !== undefined ? { time: message.timestamp } : {}),
      };
      parsed.push(assistant);
      continue;
    }
    if (isToolResultMessage(message)) {
      const toolResult: ToolResultEntry = {
        kind: "tool-result",
        id: persistedEntryId(id),
        seq: id,
        toolCallId: message.toolCallId,
        result: extractMessageText(message.content),
        ...(message.details !== undefined ? { details: message.details } : {}),
        ...(message.isError !== undefined ? { isError: message.isError } : {}),
        ...(message.timestamp !== undefined ? { time: message.timestamp } : {}),
      };
      parsed.push(toolResult);
    }
  }
  return pairToolResultOwners(parsed);
}

export function applyHistoryPage<T extends ChatEntryState>(
  state: T,
  page: SessionMessagesPageResponse,
  mode: HistoryPageMode,
): T {
  const parsed = parseHistoryEntries(page.entries);

  let local = state.entries;
  if (mode === "latest") {
    local = local.filter((entry) => {
      if (entry.seq !== undefined) return true;
      if (entry.kind === "user") return true;
      if (entry.kind === "error") return true;
      return false;
    });
  }

  const existingBySeq = new Map<number, ChatEntry>();
  for (const entry of local) {
    if (entry.seq !== undefined) existingBySeq.set(entry.seq, entry);
  }
  const mergedBySeq = new Map<number, ChatEntry>(existingBySeq);
  for (const entry of parsed) {
    if (entry.seq === undefined) continue;
    const existing = existingBySeq.get(entry.seq);
    mergedBySeq.set(entry.seq, existing ? { ...entry, id: existing.id } : entry);
  }
  const seqEntries = [...mergedBySeq.entries()]
    .sort(([a], [b]) => a - b)
    .map(([, entry]) => entry);
  const tail = local.filter((entry) => entry.seq === undefined);
  let entries = [...seqEntries, ...tail];

  let cursor = state.cursor;
  if (mode === "latest") {
    for (const pageEntry of parsed) {
      if (pageEntry.kind !== "user") continue;
      const optimisticIndex = findOptimisticUserIndex(entries, { text: pageEntry.text });
      if (optimisticIndex >= 0) {
        entries = entries.filter((_, index) => index !== optimisticIndex);
      }
    }
    for (const entry of parsed) {
      if (entry.seq !== undefined && entry.seq > cursor) cursor = entry.seq;
    }
  }

  const ids = new Set(entries.map((entry) => entry.id));
  return {
    ...state,
    entries,
    cursor,
    openStreamId: pickIfPresent(state.openStreamId, ids),
    ownerAssistantId: pickIfPresent(state.ownerAssistantId, ids),
  } as T;
}

function pairToolResultOwners(entries: ChatEntry[]): ChatEntry[] {
  const ownerByToolCall = new Map<string, EntryId>();
  for (const entry of entries) {
    if (entry.kind !== "assistant") continue;
    for (const toolCall of entry.toolCalls) {
      ownerByToolCall.set(toolCall.toolCallId, entry.id);
    }
  }
  if (ownerByToolCall.size === 0) return entries;
  return entries.map((entry) => {
    if (entry.kind !== "tool-result") return entry;
    const ownerId = ownerByToolCall.get(entry.toolCallId);
    return ownerId !== undefined ? { ...entry, ownerId } : entry;
  });
}

function pickIfPresent(id: EntryId | null, ids: Set<EntryId>): EntryId | null {
  return id !== null && ids.has(id) ? id : null;
}
