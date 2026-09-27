import type { FileChangeCard } from "../types";
import type {
  AssistantEntry,
  ChatEntry,
  EntryError,
  EntryId,
  ErrorEntry,
  ToolResultEntry,
  UserEntry,
} from "./entry";
import { applyRunChanges } from "./run-changes";
import { mergeToolResult, toolItemFromResult, type ToolItem } from "./tool-item";

export type AssistantBubble = {
  kind: "assistant";
  id: string;
  entryId: EntryId;
  seq?: number;
  text: string;
  streaming?: boolean;
  error?: EntryError;
  timestamp?: number;
  runChanges?: FileChangeCard[];
};

export type ThoughtBubble = {
  kind: "thought";
  id: string;
  entryId: EntryId;
  seq?: number;
  tools: ToolItem[];
  awaiting?: true;
  timestamp?: number;
  runChanges?: FileChangeCard[];
};

export type Bubble =
  | AssistantBubble
  | ThoughtBubble
  | { kind: "tool-result"; id: string; entryId: EntryId; seq?: number; tool: ToolItem }
  | { kind: "error"; id: string; entryId: EntryId; seq?: number; error: EntryError; timestamp?: number };

export interface MessageGroup {
  id: string;
  kind: "turn" | "trigger-turn";
  user?: UserEntry;
  triggerName?: string;
  hasError: boolean;
  bubbles: Bubble[];
}

interface TurnBuilder {
  group: MessageGroup;
  entries: ChatEntry[];
}

export function assembleGroups(entries: ChatEntry[]): MessageGroup[] {
  const groups: MessageGroup[] = [];
  let current: TurnBuilder | null = null;

  const close = () => {
    if (!current) return;
    current.group.bubbles = assembleBubbles(current.group, current.entries);
    applyRunChanges(current.group);
    groups.push(current.group);
    current = null;
  };

  for (const entry of entries) {
    if (entry.kind === "user") {
      close();
      const group: MessageGroup = {
        id: `g:${entry.id}`,
        kind: entry.triggered ? "trigger-turn" : "turn",
        user: entry,
        ...(entry.triggerName !== undefined ? { triggerName: entry.triggerName } : {}),
        hasError: false,
        bubbles: [],
      };
      current = { group, entries: [] };
      continue;
    }
    if (!current) {
      const group: MessageGroup = {
        id: `g:head:${entry.id}`,
        kind: "turn",
        hasError: false,
        bubbles: [],
      };
      current = { group, entries: [entry] };
      continue;
    }
    current.entries.push(entry);
  }
  close();
  return groups;
}

function assembleBubbles(group: MessageGroup, entries: ChatEntry[]): Bubble[] {
  const assistantEntries: AssistantEntry[] = [];
  const toolResults: ToolResultEntry[] = [];
  const errorEntries: ErrorEntry[] = [];
  for (const entry of entries) {
    if (entry.kind === "assistant") assistantEntries.push(entry);
    else if (entry.kind === "tool-result") toolResults.push(entry);
    else if (entry.kind === "error") errorEntries.push(entry);
  }

  let interruptedEntryId: EntryId | undefined;
  let interruptedError: EntryError | undefined;
  const standaloneErrors: ErrorEntry[] = [];
  if (errorEntries.length > 0) {
    const streamingTarget = findLast(assistantEntries, (candidate) => candidate.streaming === true);
    if (streamingTarget) {
      interruptedEntryId = streamingTarget.id;
      interruptedError = entryError(errorEntries[errorEntries.length - 1]);
    } else {
      standaloneErrors.push(...errorEntries);
    }
    group.hasError = true;
  }

  const bubbles: Bubble[] = [];

  let thought: ThoughtBubble | undefined;
  if (assistantEntries.length > 0) {
    const anchor = assistantEntries[0];
    const tools: ToolItem[] = assistantEntries.flatMap((entry) =>
      entry.toolCalls.map((toolCall) => ({
        toolCallId: toolCall.toolCallId,
        toolName: toolCall.toolName,
        args: toolCall.args,
        status: entry.seq !== undefined ? ("completed" as const) : ("running" as const),
      })),
    );
    const awaiting = assistantEntries.some(
      (entry) => entry.streaming === true && entry.text === "" && entry.toolCalls.length === 0,
    );
    thought = {
      kind: "thought",
      id: `b:thought:${anchor.id}`,
      entryId: anchor.id,
      ...(anchor.seq !== undefined ? { seq: anchor.seq } : {}),
      tools,
      ...(awaiting ? { awaiting: true } : {}),
      ...(anchor.time !== undefined ? { timestamp: anchor.time } : {}),
    };
    bubbles.push(thought);
  }

  for (const entry of assistantEntries) {
    const interrupted = entry.id === interruptedEntryId;
    const error = entry.error ?? (interrupted ? interruptedError : undefined);
    if (entry.text === "" && error === undefined) continue;
    if (error !== undefined) group.hasError = true;
    const streaming = entry.streaming === true && !interrupted;
    bubbles.push({
      kind: "assistant",
      id: `b:${entry.id}`,
      entryId: entry.id,
      ...(entry.seq !== undefined ? { seq: entry.seq } : {}),
      text: entry.text,
      ...(streaming ? { streaming: true } : {}),
      ...(error !== undefined ? { error } : {}),
      ...(entry.time !== undefined ? { timestamp: entry.time } : {}),
    });
  }

  const assistantEntryIds = new Set(assistantEntries.map((entry) => entry.id));
  for (const result of toolResults) {
    const owned =
      thought !== undefined &&
      ((result.ownerId !== undefined && assistantEntryIds.has(result.ownerId)) ||
        thought.tools.some((tool) => tool.toolCallId === result.toolCallId));
    if (thought && owned) {
      mergeToolResult(thought.tools, result);
      continue;
    }
    bubbles.push({
      kind: "tool-result",
      id: `b:${result.id}`,
      entryId: result.id,
      ...(result.seq !== undefined ? { seq: result.seq } : {}),
      tool: toolItemFromResult(result),
    });
  }

  for (const error of standaloneErrors) {
    bubbles.push({
      kind: "error",
      id: `b:${error.id}`,
      entryId: error.id,
      ...(error.seq !== undefined ? { seq: error.seq } : {}),
      error: entryError(error),
      ...(error.time !== undefined ? { timestamp: error.time } : {}),
    });
  }

  return bubbles;
}

function findLast<T>(items: T[], predicate: (item: T) => boolean): T | undefined {
  for (let index = items.length - 1; index >= 0; index--) {
    if (predicate(items[index])) return items[index];
  }
  return undefined;
}

function entryError(entry: { message: string; code?: EntryError["code"]; retrySuppressed?: boolean }): EntryError {
  return {
    message: entry.message,
    ...(entry.code !== undefined ? { code: entry.code } : {}),
    ...(entry.retrySuppressed ? { retrySuppressed: true } : {}),
  };
}
