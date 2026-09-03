import { aggregateFileChanges } from "../lib/aggregate-file-changes";
import { projectChatCard } from "./tool-card";
import type {
  ChatMessage,
  ChatSessionData,
  InteractionState,
  RenderItem,
  RunState,
  ToolCallInfo,
} from "../types";

export function buildRenderList(session: ChatSessionData): RenderItem[] {
  const items: RenderItem[] = [];

  for (let index = 0; index < session.history.messages.length; index++) {
    const message = session.history.messages[index];
    items.push({
      key: message._messageId !== undefined ? `h-${message._messageId}` : `h-idx-${index}`,
      message,
    });
  }

  const interactionsByToolCall = new Map<string, InteractionState>();
  for (const interaction of Object.values(session.interactions)) {
    interactionsByToolCall.set(interaction.toolCallId, interaction);
  }

  const tail = [
    ...session.outbox.map((entry) => ({ kind: "outbox" as const, seq: entry.seq, entry })),
    ...session.runs.map((run) => ({ kind: "run" as const, seq: run.id, run })),
  ].sort((a, b) => a.seq - b.seq);

  for (const node of tail) {
    if (node.kind === "outbox") {
      items.push({
        key: `o-${node.entry.id}`,
        message: {
          role: "user",
          content: node.entry.content,
          ...(node.entry.attachments ? { _attachments: node.entry.attachments } : {}),
          timestamp: node.entry.timestamp,
        },
        ...(node.entry.status === "failed" ? { sendFailed: true } : {}),
      });
      continue;
    }
    appendRunItems(items, node.run, interactionsByToolCall);
  }

  applySessionFlags(items, session);
  applyRunChanges(items);
  return items;
}

function appendRunItems(
  items: RenderItem[],
  run: RunState,
  interactionsByToolCall: Map<string, InteractionState>,
): void {
  for (let segIndex = 0; segIndex < run.segments.length; segIndex++) {
    const segment = run.segments[segIndex];
    const isTail = segIndex === run.segments.length - 1;
    const streaming = run.active && isTail && !segment.finished;
    const toolCalls = projectToolCalls(segment.toolCalls, interactionsByToolCall);
    items.push({
      key: `r-${run.id}-${segIndex}`,
      message: {
        role: "assistant",
        content: segment.content,
        ...(toolCalls.length > 0 ? { _toolCalls: toolCalls } : {}),
        ...(segment.error
          ? {
              _error: segment.error.message,
              ...(segment.error.code !== undefined ? { _errorCode: segment.error.code } : {}),
              _turnError: segment.error.turnError,
            }
          : {}),
        ...(segment.timestamp !== undefined ? { timestamp: segment.timestamp } : {}),
      },
      ...(streaming ? { streaming: true } : {}),
    });
  }
}

function projectToolCalls(
  toolCalls: ToolCallInfo[],
  interactionsByToolCall: Map<string, InteractionState>,
): ToolCallInfo[] {
  return toolCalls.map((toolCall) => {
    const card = projectChatCard(toolCall.toolName, toolCall.args, {
      ...(toolCall.partialDetails !== undefined ? { partialDetails: toolCall.partialDetails } : {}),
      ...(toolCall.resultDetails !== undefined ? { resultDetails: toolCall.resultDetails } : {}),
      ...(toolCall.isError !== undefined ? { isError: toolCall.isError } : {}),
      interaction: interactionsByToolCall.get(toolCall.toolCallId),
    });
    return card !== undefined ? { ...toolCall, _card: card } : toolCall;
  });
}

function applySessionFlags(items: RenderItem[], session: ChatSessionData): void {
  if (items.length === 0) return;
  if (session.withdrawError) {
    for (let i = items.length - 1; i >= 0; i--) {
      if (items[i].message.role === "user") break;
      if (items[i].message._error !== undefined) {
        items[i].withdrawError = true;
        break;
      }
    }
  }
}

function applyRunChanges(items: RenderItem[]): void {
  if (items.length === 0) return;
  const messages = items.map((item) => item.message);
  const runEndIndices: number[] = [];
  for (let i = 1; i < messages.length; i++) {
    if (messages[i].role === "user") runEndIndices.push(i - 1);
  }
  runEndIndices.push(messages.length - 1);

  const patches = new Map<number, ChatMessage>();
  for (const runEndIndex of runEndIndices) {
    const changes = aggregateFileChanges(messages, runEndIndex);
    if (changes.length === 0) continue;
    const runStart = findRunStart(messages, runEndIndex);
    for (let i = runEndIndex; i >= runStart; i--) {
      if (messages[i].role !== "assistant") continue;
      patches.set(i, { ...messages[i], _runChanges: changes });
      break;
    }
  }
  for (const [index, message] of patches) {
    items[index] = { ...items[index], message };
  }
}

function findRunStart(messages: ChatMessage[], runEndIndex: number): number {
  for (let i = Math.min(runEndIndex, messages.length - 1); i > 0; i--) {
    if (messages[i].role === "user") return i + 1;
  }
  return 0;
}
