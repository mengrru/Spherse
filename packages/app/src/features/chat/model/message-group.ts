import type { FileChangeCard } from "../types";
import type {
  AssistantEntry,
  ChatEntry,
  EntryError,
  EntryId,
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
  tools: ToolItem[];
  streaming?: boolean;
  error?: EntryError;
  timestamp?: number;
  runChanges?: FileChangeCard[];
};

export type Bubble =
  | AssistantBubble
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

interface GroupBuilder {
  group: MessageGroup;
  bubblesByEntryId: Map<EntryId, AssistantBubble>;
}

export function assembleGroups(entries: ChatEntry[]): MessageGroup[] {
  const groups: MessageGroup[] = [];
  let current: GroupBuilder | null = null;

  const close = () => {
    if (!current) return;
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
      current = { group, bubblesByEntryId: new Map() };
      continue;
    }
    if (!current) {
      const group: MessageGroup = {
        id: `g:head:${entry.id}`,
        kind: "turn",
        hasError: false,
        bubbles: [],
      };
      current = { group, bubblesByEntryId: new Map() };
    }
    if (entry.kind === "assistant") {
      const bubble = assistantBubble(entry);
      current.group.bubbles.push(bubble);
      current.bubblesByEntryId.set(entry.id, bubble);
      if (entry.error) current.group.hasError = true;
      continue;
    }
    if (entry.kind === "tool-result") {
      const owner = entry.ownerId !== undefined ? current.bubblesByEntryId.get(entry.ownerId) : undefined;
      if (owner) {
        mergeToolResult(owner.tools, entry);
        continue;
      }
      const fallback = findToolOwnerBubble(current.group.bubbles, entry.toolCallId);
      if (fallback) {
        mergeToolResult(fallback.tools, entry);
        continue;
      }
      current.group.bubbles.push({
        kind: "tool-result",
        id: `b:${entry.id}`,
        entryId: entry.id,
        ...(entry.seq !== undefined ? { seq: entry.seq } : {}),
        tool: toolItemFromResult(entry),
      });
      continue;
    }

    current.group.hasError = true;
    const last = current.group.bubbles[current.group.bubbles.length - 1];
    if (last?.kind === "assistant" && last.streaming) {
      const updated: AssistantBubble = {
        ...last,
        streaming: false,
        error: entryError(entry),
      };
      current.group.bubbles[current.group.bubbles.length - 1] = updated;
      current.bubblesByEntryId.set(last.entryId, updated);
      continue;
    }
    current.group.bubbles.push({
      kind: "error",
      id: `b:${entry.id}`,
      entryId: entry.id,
      ...(entry.seq !== undefined ? { seq: entry.seq } : {}),
      error: entryError(entry),
      ...(entry.time !== undefined ? { timestamp: entry.time } : {}),
    });
  }
  close();
  return groups;
}
function entryError(entry: { message: string; code?: EntryError["code"]; retrySuppressed?: boolean }): EntryError {
  return {
    message: entry.message,
    ...(entry.code !== undefined ? { code: entry.code } : {}),
    ...(entry.retrySuppressed ? { retrySuppressed: true } : {}),
  };
}

function assistantBubble(entry: AssistantEntry): AssistantBubble {
  const persisted = entry.seq !== undefined;
  return {
    kind: "assistant",
    id: `b:${entry.id}`,
    entryId: entry.id,
    ...(entry.seq !== undefined ? { seq: entry.seq } : {}),
    text: entry.text,
    tools: entry.toolCalls.map((toolCall) => ({
      toolCallId: toolCall.toolCallId,
      toolName: toolCall.toolName,
      args: toolCall.args,
      status: persisted ? "completed" : "running",
    })),
    ...(entry.streaming ? { streaming: true } : {}),
    ...(entry.error ? { error: entry.error } : {}),
    ...(entry.time !== undefined ? { timestamp: entry.time } : {}),
  };
}

function findToolOwnerBubble(bubbles: Bubble[], toolCallId: string): AssistantBubble | undefined {
  for (let index = bubbles.length - 1; index >= 0; index--) {
    const bubble = bubbles[index];
    if (bubble.kind === "assistant" && bubble.tools.some((tool) => tool.toolCallId === toolCallId)) {
      return bubble;
    }
  }
  return undefined;
}
