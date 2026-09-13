import type { ChatAttachment, SendableImage } from "../types";
import type { ChatEntry, UserEntry } from "./entry";
import type { MessageGroup } from "./message-group";
import type { ToolItem } from "./tool-item";

export function computeSupersededToolCallIds(groups: MessageGroup[]): Set<string> {
  const tools: ToolItem[] = [];
  const latestByPath = new Map<string, string>();
  for (const group of groups) {
    for (const bubble of group.bubbles) {
      if (bubble.kind !== "assistant") continue;
      for (const tool of bubble.tools) {
        tools.push(tool);
        const card = tool.card;
        if (card?.type === "html" && card.file_path) {
          latestByPath.set(card.file_path, tool.toolCallId);
        }
      }
    }
  }
  const superseded = new Set<string>();
  if (latestByPath.size === 0) return superseded;
  for (const tool of tools) {
    const card = tool.card;
    if (card?.type === "html" && card.file_path && latestByPath.get(card.file_path) !== tool.toolCallId) {
      superseded.add(tool.toolCallId);
    }
  }
  return superseded;
}

export function lastWithdrawableUserEntry(entries: ChatEntry[]): UserEntry | undefined {
  for (let index = entries.length - 1; index >= 0; index--) {
    const entry = entries[index];
    if (entry.kind !== "user") continue;
    return entry.sendFailed ? undefined : entry;
  }
  return undefined;
}

export type RetryPlan =
  | { kind: "none" }
  | { kind: "retry-last" }
  | { kind: "resend"; content: string; attachment?: SendableImage; dropCount: number };

export function planRetry(entries: ChatEntry[]): RetryPlan {
  const last = entries[entries.length - 1];
  if (!last) return { kind: "none" };
  if (last.kind === "assistant" && last.error) {
    return last.error.retrySuppressed ? { kind: "none" } : { kind: "retry-last" };
  }
  if (last.kind === "error") {
    if (last.retrySuppressed) return { kind: "none" };
    const userIndex = findLastUserIndex(entries);
    if (userIndex < 0) return { kind: "none" };
    const user = entries[userIndex] as UserEntry;
    return {
      kind: "resend",
      content: user.text,
      attachment: toSendable(user),
      dropCount: entries.length - userIndex,
    };
  }
  if (last.kind === "user" && last.sendFailed) {
    return {
      kind: "resend",
      content: last.text,
      attachment: toSendable(last),
      dropCount: 1,
    };
  }
  return { kind: "none" };
}

export interface PendingControl {
  kind: "approval" | "question";
  requestId: string;
  toolName: string;
  command?: string;
}

export function collectPendingControls(groups: MessageGroup[]): PendingControl[] {
  const result: PendingControl[] = [];
  for (const group of groups) {
    for (const bubble of group.bubbles) {
      if (bubble.kind !== "assistant") continue;
      for (const tool of bubble.tools) {
        const card = tool.card;
        if (!card) continue;
        if (card.type === "command" && card.requestId) {
          result.push({ kind: "approval", requestId: card.requestId, toolName: tool.toolName, command: card.command });
        } else if (card.type === "approval" && card.requestId) {
          result.push({ kind: "approval", requestId: card.requestId, toolName: tool.toolName });
        } else if (card.type === "question" && card.requestId) {
          result.push({ kind: "question", requestId: card.requestId, toolName: tool.toolName });
        }
      }
    }
  }
  return result;
}

export function shouldShowThinking(entries: ChatEntry[], streaming: boolean): boolean {
  if (!streaming) return false;
  const last = entries[entries.length - 1];
  return last?.kind === "user";
}

function findLastUserIndex(entries: ChatEntry[]): number {
  for (let index = entries.length - 1; index >= 0; index--) {
    if (entries[index].kind === "user") return index;
  }
  return -1;
}

function toSendable(entry: UserEntry): SendableImage | undefined {
  const attachment: ChatAttachment | undefined = entry.attachments?.[0];
  if (!attachment) return undefined;
  return {
    path: attachment.path,
    mimeType: attachment.mimeType,
    ...(attachment.width != null ? { width: attachment.width } : {}),
    ...(attachment.height != null ? { height: attachment.height } : {}),
  };
}
