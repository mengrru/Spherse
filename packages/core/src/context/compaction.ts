import type {
  Message,
  UserMessage,
  ToolCall,
} from "@earendil-works/pi-ai";

const MAX_MESSAGE_CHARS = 500;
const TRUNCATE_MARKER = "…";

export interface CompactionOptions {
  currentTokens: number;
  contextWindow: number;
  keepRecentTurns?: number;
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

function extractToolArg(
  toolName: string,
  args: Record<string, unknown>,
): string {
  if (toolName === "move_file" || toolName === "copy_file") {
    const src = typeof args.source === "string" ? args.source : "";
    const dst = typeof args.destination === "string" ? args.destination : "";
    return `${src} → ${dst}`.trim();
  }
  const FILE_TOOLS = new Set(["read_file", "write_file", "edit_file"]);
  if (FILE_TOOLS.has(toolName)) {
    const path = args.path ?? args.file_path;
    if (typeof path === "string") return path;
    return "";
  }
  if (toolName === "search_content") {
    return typeof args.query === "string" ? args.query : "";
  }
  if (toolName === "load_skill") {
    return typeof args.skill_name === "string" ? args.skill_name : "";
  }
  const keys = Object.keys(args);
  if (keys.length === 0) return "";
  const value = args[keys[0]];
  return value === undefined || value === null ? "" : String(value);
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

export function planCompaction(
  messages: Message[],
  options: CompactionOptions,
): CompactionPlan {
  const thresholdRatio = options.thresholdRatio ?? 0.75;
  const keepRecentTurns = options.keepRecentTurns ?? 20;

  const shouldCompact =
    options.currentTokens > options.contextWindow * thresholdRatio;
  if (!shouldCompact) {
    return { shouldCompact: false, anchorIndex: -1, digest: null, tail: messages };
  }

  let userCount = 0;
  for (const message of messages) {
    if (message.role === "user") userCount++;
  }
  if (userCount <= keepRecentTurns) {
    return { shouldCompact: false, anchorIndex: -1, digest: null, tail: messages };
  }

  let firstKeptUserIndex = -1;
  let count = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "user") {
      count++;
      if (count === keepRecentTurns) {
        firstKeptUserIndex = i;
        break;
      }
    }
  }

  const anchorIndex = firstKeptUserIndex - 1;
  if (anchorIndex < 0) {
    return { shouldCompact: false, anchorIndex: -1, digest: null, tail: messages };
  }

  const digest = generateDigest(messages.slice(0, anchorIndex + 1));
  const tail = messages.slice(anchorIndex + 1);
  return { shouldCompact: true, anchorIndex, digest, tail };
}
