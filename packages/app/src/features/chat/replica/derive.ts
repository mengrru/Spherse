import type { AssistantMessage, ToolCall as AgentToolCall } from "@spherse/core";
import { isToolResultMessage, isUserMessage, isAssistantMessage } from "../model/agent-event-parse";
import {
  buildCardFromToolResult,
  extractMessageText,
  extractToolCalls,
} from "../model/chat-tool-projection";
import { classifyErrorMessageString } from "../model/classify-error";
import { aggregateFileChanges, attachRunChanges } from "../lib/aggregate-file-changes";
import type { ChatMessage, ToolCallInfo } from "../types";
import type { DurableEntry } from "./durable";
import type { RunTail } from "./run-tail";
import type { PendingZone } from "./intents";
import type { ChatNotice } from "./notices";
import type { SessionReplica } from "./session-replica";

export interface KeyedMessage {
  key: string;
  message: ChatMessage;
}

export interface DerivedView {
  keyed: KeyedMessage[];
  messages: ChatMessage[];
  streaming: boolean;
}

export function deriveReplica(state: SessionReplica): DerivedView {
  const runScopeStart = state.run.active ? (state.run.startedAfterSeq ?? -1) : Number.POSITIVE_INFINITY;
  const projected = projectDurableEntries(state.durable.entries);
  const overlayMerged = mergeToolOverlay(projected, state.run);
  const aggregated = attachRunAggregations(overlayMerged, runScopeStart);

  let keyed: KeyedMessage[] = aggregated.map((entry) => ({
    key: `seq:${entry.seq}`,
    message: entry.message,
  }));

  keyed = appendPending(keyed, state.pending);
  keyed = appendOverlayTail(keyed, state.run, aggregated);
  keyed = applyRetryingProjection(keyed, state.run);
  keyed = appendNotices(keyed, state.notices.items, state.run);

  const streaming = state.run.active || state.run.retrying || state.pending.intents.some((intent) => intent.state === "sending");

  return { keyed, messages: keyed.map((entry) => entry.message), streaming };
}

interface ProjectedEntry {
  seq: number;
  message: ChatMessage;
}

function projectDurableEntries(entries: DurableEntry[]): ProjectedEntry[] {
  const toolResultMap = collectToolResults(entries);
  const projected: ProjectedEntry[] = [];

  for (const entry of entries) {
    if (isUserMessage(entry.message)) {
      const rawAttachments = (entry.message as { _attachments?: unknown })._attachments;
      projected.push({
        seq: entry.seq,
        message: {
          _messageId: entry.seq,
          role: "user",
          content: extractMessageText(entry.message.content),
          ...(Array.isArray(rawAttachments) && rawAttachments.length > 0
            ? { _attachments: rawAttachments as ChatMessage["_attachments"] }
            : {}),
          ...(entry.source === "triggered" ? { _triggered: true as const } : {}),
          ...(entry.source === "triggered" && entry.triggerName !== undefined ? { _triggerName: entry.triggerName } : {}),
          timestamp: entry.message.timestamp,
        },
      });
      continue;
    }
    if (isAssistantMessage(entry.message)) {
      const toolCalls = extractToolCalls(entry.message);
      const enriched = toolCalls ? enrichToolCalls(toolCalls, entry.message, toolResultMap) : undefined;
      const isError = entry.message.stopReason === "error";
      projected.push({
        seq: entry.seq,
        message: {
          _messageId: entry.seq,
          role: "assistant",
          content: extractMessageText(entry.message.content),
          ...(enriched && enriched.length > 0 ? { _toolCalls: enriched } : {}),
          ...(isError
            ? {
                _error: entry.message.errorMessage ?? "Unknown error",
                _errorCode: classifyErrorMessageString(entry.message.errorMessage ?? "Unknown error"),
                _turnError: true,
              }
            : {}),
          timestamp: entry.message.timestamp,
        },
      });
    }
  }
  return projected;
}

interface ToolResultBag {
  result: string;
  isError: boolean;
  details: unknown;
}

function collectToolResults(entries: DurableEntry[]): Map<string, ToolResultBag> {
  const map = new Map<string, ToolResultBag>();
  for (const entry of entries) {
    if (!isToolResultMessage(entry.message)) continue;
    map.set(entry.message.toolCallId, {
      result: extractMessageText(entry.message.content),
      isError: entry.message.isError ?? false,
      details: entry.message.details,
    });
  }
  return map;
}

function enrichToolCalls(
  toolCalls: ToolCallInfo[],
  message: AssistantMessage,
  toolResultMap: Map<string, ToolResultBag>,
): ToolCallInfo[] {
  if (!Array.isArray(message.content)) return toolCalls;
  return toolCalls.map((info) => {
    const original = message.content.find(
      (item): item is AgentToolCall =>
        item.type === "toolCall" && item.id === info.toolCallId,
    );
    if (!original) return info;
    const toolResult = toolResultMap.get(info.toolCallId);
    const card = buildCardFromToolResult(original.name, original, toolResult?.details);
    return {
      ...info,
      result: toolResult?.result,
      status: toolResult ? (toolResult.isError ? "error" : "completed") : "completed",
      ...(card ? { _card: card } : {}),
    };
  });
}

function mergeToolOverlay(projected: ProjectedEntry[], run: RunTail): ProjectedEntry[] {
  if (run.tools.length === 0) return projected;
  const runScopeStart = run.startedAfterSeq ?? -1;
  const overlayById = new Map(run.tools.map((toolCall) => [toolCall.toolCallId, toolCall]));
  let changed = false;
  const merged = projected.map((entry) => {
    if (entry.seq <= runScopeStart || entry.message.role !== "assistant" || !entry.message._toolCalls) {
      return entry;
    }
    const tools = entry.message._toolCalls;
    if (!tools.some((toolCall) => overlayById.has(toolCall.toolCallId))) return entry;
    const nextTools = tools.map((toolCall) => {
      const overlay = overlayById.get(toolCall.toolCallId);
      if (!overlay) return toolCall;
      return {
        ...toolCall,
        status: overlay.status,
        ...(overlay.result !== undefined ? { result: overlay.result } : {}),
        ...(overlay.partialResult !== undefined ? { partialResult: overlay.partialResult } : {}),
        ...(overlay._card !== undefined ? { _card: overlay._card } : {}),
      };
    });
    changed = true;
    return { seq: entry.seq, message: { ...entry.message, _toolCalls: nextTools } };
  });
  return changed ? merged : projected;
}

function attachRunAggregations(projected: ProjectedEntry[], runScopeStart: number): ProjectedEntry[] {
  if (projected.length === 0) return projected;
  const runEndIndices: number[] = [];
  for (let i = 1; i < projected.length; i++) {
    if (projected[i].message.role === "user" && projected[i].seq <= runScopeStart) {
      runEndIndices.push(i - 1);
    }
  }
  if (projected[projected.length - 1].seq <= runScopeStart) {
    runEndIndices.push(projected.length - 1);
  }

  let result = projected;
  for (const runEndIndex of runEndIndices) {
    const window = result.slice(0, runEndIndex + 1).map((entry) => entry.message);
    const changes = aggregateFileChanges(window, runEndIndex);
    if (changes.length === 0) continue;
    const withChanges = attachRunChanges(window, runEndIndex, changes);
    result = result.map((entry, index) => (
      index <= runEndIndex && withChanges[index] !== window[index]
        ? { seq: entry.seq, message: withChanges[index] }
        : entry
    ));
  }
  return result;
}

function appendOverlayTail(keyed: KeyedMessage[], run: RunTail, projected: ProjectedEntry[]): KeyedMessage[] {
  let next = keyed;
  if (run.tools.length > 0) {
    const runScopeStart = run.startedAfterSeq ?? -1;
    const inScope = new Set(
      projected
        .filter((entry) => entry.seq > runScopeStart && entry.message.role === "assistant")
        .flatMap((entry) => entry.message._toolCalls ?? [])
        .map((toolCall) => toolCall.toolCallId),
    );
    const unmatched = run.tools.filter((toolCall) => !inScope.has(toolCall.toolCallId));
    if (unmatched.length > 0) {
      next = [
        ...next,
        {
          key: "block:tools",
          message: { role: "assistant", content: "", _streaming: run.active, _toolCalls: unmatched },
        },
      ];
    }
  }
  if (run.draft) {
    next = [...next, { key: "block:draft", message: run.draft }];
  }
  return next;
}

function applyRetryingProjection(keyed: KeyedMessage[], run: RunTail): KeyedMessage[] {
  if (!run.retrying || keyed.length === 0) return keyed;
  const last = keyed[keyed.length - 1];
  if (last.message.role !== "assistant" || !last.message._error) return keyed;
  const { _error, _errorCode, _turnError, ...rest } = last.message;
  return [
    ...keyed.slice(0, -1),
    { key: last.key, message: { ...rest, _streaming: true } },
  ];
}

function appendPending(keyed: KeyedMessage[], pending: PendingZone): KeyedMessage[] {
  const entries = pending.intents.filter((intent) => intent.state !== "queued");
  if (entries.length === 0) return keyed;
  return [
    ...keyed,
    ...entries.map((intent) => ({
      key: `intent:${intent.intentId}`,
      message: {
        role: "user" as const,
        content: intent.content,
        timestamp: intent.createdAt,
        ...(intent.state === "sending" ? { _optimistic: true as const } : { _sendFailed: true as const }),
        ...(intent.attachment
          ? {
              _attachments: [{
                type: "image" as const,
                path: intent.attachment.path,
                mimeType: intent.attachment.mimeType,
                ...(intent.attachment.width != null ? { width: intent.attachment.width } : {}),
                ...(intent.attachment.height != null ? { height: intent.attachment.height } : {}),
              }],
            }
          : {}),
      },
    })),
  ];
}

function appendNotices(keyed: KeyedMessage[], notices: ChatNotice[], run: RunTail): KeyedMessage[] {
  if (notices.length === 0) return keyed;
  let next = keyed;

  const attachedToDraft = new Set<string>();
  const lastErrorNotice = [...notices].reverse().find((notice) => notice.kind === "error" && notice.turnError);
  if (lastErrorNotice && run.draft) {
    const draftIndex = next.findIndex((entry) => entry.key === "block:draft");
    if (draftIndex >= 0) {
      attachedToDraft.add(lastErrorNotice.id);
      const draft = next[draftIndex].message;
      next = [
        ...next.slice(0, draftIndex),
        {
          key: "block:draft",
          message: {
            ...draft,
            _error: lastErrorNotice.message,
            _errorCode: lastErrorNotice.code,
            _turnError: true,
          },
        },
        ...next.slice(draftIndex + 1),
      ];
    }
  }

  for (const notice of notices) {
    if (notice.kind === "error" && attachedToDraft.has(notice.id)) continue;
    next = [
      ...next,
      {
        key: `notice:${notice.id}`,
        message: {
          role: "assistant" as const,
          content: "",
          _error: notice.message,
          ...(notice.code !== undefined ? { _errorCode: notice.code } : {}),
        },
      },
    ];
  }

  if (notices.some((notice) => notice.kind === "withdrawFailed")) {
    for (let i = next.length - 1; i >= 0; i--) {
      const message = next[i].message;
      if (message.role !== "assistant") break;
      if (message._error) {
        next = [
          ...next.slice(0, i),
          { key: next[i].key, message: { ...message, _withdrawError: true } },
          ...next.slice(i + 1),
        ];
        break;
      }
    }
  }

  return next;
}
