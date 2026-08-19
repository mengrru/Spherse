import type {
  Message,
  UserMessage,
  AssistantMessage,
  ToolResultMessage,
  ToolCall,
} from "@earendil-works/pi-ai";

const MAX_MESSAGE_CHARS = 500;
const TRUNCATE_MARKER = "…";

export interface CompactionOptions {
  currentTokens: number;
  contextWindow: number;
  keepRecentPrompts?: number;
  maxTurns?: number;
  thresholdRatio?: number;
}

export interface CompactionPlan {
  shouldCompact: boolean;
  anchorIndex: number;
  digest: string | null;
  tail: Message[];
}

function extractUserText(message: UserMessage): string {
  if (typeof message.content === "string") return message.content;
  return message.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("");
}

function truncate(text: string): string {
  if (text.length <= MAX_MESSAGE_CHARS) return text;
  return text.slice(0, MAX_MESSAGE_CHARS) + TRUNCATE_MARKER;
}

const MAX_ARG_VALUE_CHARS = 120;

function extractToolArg(
  _toolName: string,
  args: Record<string, unknown>,
): string {
  const summaryValues: string[] = [];
  for (const value of Object.values(args)) {
    if (summaryValues.length >= 2) break;
    if (typeof value === "string" && value.length > 0 && value.length <= MAX_ARG_VALUE_CHARS) {
      summaryValues.push(value);
    }
  }
  return summaryValues.join(" → ");
}

export function generateDigest(messages: Message[]): string {
  const lines: string[] = [];

  for (const message of messages) {
    if (message.role === "user") {
      const text = extractUserText(message);
      lines.push(`[user]: ${truncate(text)}`);
    } else if (message.role === "assistant") {
      const textParts: string[] = [];
      const toolCallParts: string[] = [];
      for (const block of message.content) {
        if (block.type === "text" && typeof block.text === "string") {
          textParts.push(block.text);
        } else if (block.type === "toolCall") {
          const toolCall = block as ToolCall;
          const argSummary = extractToolArg(toolCall.name, toolCall.arguments);
          toolCallParts.push(argSummary ? `${toolCall.name}: ${argSummary}` : toolCall.name);
        }
      }
      const textPart = textParts.join("");
      const toolPart = toolCallParts.map((t) => `[called ${t}]`).join(" ");
      const body = `${textPart}${toolPart ? ` ${toolPart}` : ""}`.trim();
      lines.push(`[assistant]: ${truncate(body)}`);
    }
  }

  return lines.join("\n");
}

export function wrapDigestContent(plainText: string, covers?: string): string {
  const coversAttr = covers ? ` covers="${covers}"` : "";
  const lines: string[] = [];
  lines.push(`<compaction-digest${coversAttr}>`);
  lines.push("Earlier conversation (summarized to save context):");
  lines.push("");
  lines.push(plainText);
  lines.push("</compaction-digest>");
  return lines.join("\n");
}

function isDigestMessage(msg: Message): boolean {
  if (msg.role !== "user") return false;
  if (typeof msg.content === "string") {
    return msg.content.includes("<compaction-digest");
  }
  if (Array.isArray(msg.content)) {
    return msg.content.some(
      (block) =>
        block.type === "text" &&
        typeof block.text === "string" &&
        block.text.includes("<compaction-digest"),
    );
  }
  return false;
}

export function planCompaction(
  messages: Message[],
  options: CompactionOptions,
): CompactionPlan {
  const thresholdRatio = options.thresholdRatio ?? 0.75;
  const keepRecentPrompts = options.keepRecentPrompts ?? 20;
  const maxTurns = options.maxTurns ?? 50;

  const shouldCompact =
    options.currentTokens > options.contextWindow * thresholdRatio;
  if (!shouldCompact) {
    return { shouldCompact: false, anchorIndex: -1, digest: null, tail: messages };
  }

  let promptCount = 0;
  let turnCount = 0;
  for (const message of messages) {
    if (message.role === "user" && !isDigestMessage(message)) promptCount++;
    if (message.role === "assistant") turnCount++;
  }
  if (promptCount <= keepRecentPrompts && turnCount <= maxTurns) {
    return { shouldCompact: false, anchorIndex: -1, digest: null, tail: messages };
  }

  const promptSplit = findPromptSplit(messages, keepRecentPrompts);
  const turnSplit = findTurnSplit(messages, maxTurns);

  const firstKeptUserIndex = Math.max(promptSplit, turnSplit);
  if (firstKeptUserIndex <= 0) {
    return { shouldCompact: false, anchorIndex: -1, digest: null, tail: messages };
  }

  const anchorIndex = firstKeptUserIndex - 1;
  const digest = generateDigest(messages.slice(0, anchorIndex + 1));
  const tail = messages.slice(anchorIndex + 1);
  return { shouldCompact: true, anchorIndex, digest, tail };
}

function findPromptSplit(
  messages: Message[],
  keepCount: number,
): number {
  let count = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "user" && !isDigestMessage(messages[i])) {
      count++;
      if (count === keepCount) return i;
    }
  }
  return -1;
}

function findTurnSplit(
  messages: Message[],
  maxTurns: number,
): number {
  let assistantCount = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "assistant") {
      assistantCount++;
      if (assistantCount > maxTurns) {
        for (let j = i + 1; j < messages.length; j++) {
          if (messages[j].role === "user") return j;
        }
        return messages.length;
      }
    }
  }
  return -1;
}

export interface SanitizeResult {
  messages: Message[];
  keptIndices: number[];
}

export function sanitizeToolCallPairs(messages: Message[]): SanitizeResult {
  const result: Message[] = [];
  const keptIndices: number[] = [];
  const validToolCallIds = new Set<string>();

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    if (msg.role === "assistant") {
      const am = msg as AssistantMessage;
      if (am.stopReason === "error" || am.stopReason === "aborted") {
        continue;
      }
      for (const block of am.content) {
        if (block.type === "toolCall") {
          validToolCallIds.add((block as ToolCall).id);
        }
      }
      result.push(msg);
      keptIndices.push(i);
    } else if (msg.role === "toolResult") {
      const tr = msg as ToolResultMessage;
      if (validToolCallIds.has(tr.toolCallId)) {
        result.push(msg);
        keptIndices.push(i);
      }
    } else {
      result.push(msg);
      keptIndices.push(i);
    }
  }

  return { messages: result, keptIndices };
}
