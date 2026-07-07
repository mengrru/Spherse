import type { Message } from "@earendil-works/pi-ai";

interface ContentBlock {
  type: string;
  text?: string;
  thinking?: string;
  content?: string;
  arguments?: unknown;
}

function estimateString(input: string): number {
  if (input.length === 0) return 0;
  let cjk = 0;
  let other = 0;
  for (const ch of input) {
    const code = ch.codePointAt(0);
    if (code === undefined) {
      other += 1;
      continue;
    }
    if (
      (code >= 0x4e00 && code <= 0x9fff) ||
      (code >= 0x3040 && code <= 0x30ff) ||
      (code >= 0xac00 && code <= 0xd7af)
    ) {
      cjk += 1;
    } else {
      other += 1;
    }
  }
  return Math.ceil(cjk / 1.5 + other / 4);
}

function extractTextFromBlock(block: ContentBlock): string {
  switch (block.type) {
    case "text":
      return typeof block.text === "string" ? block.text : "";
    case "thinking":
      if (typeof block.text === "string") return block.text;
      if (typeof block.thinking === "string") return block.thinking;
      if (typeof block.content === "string") return block.content;
      return "";
    case "toolCall":
      try {
        return JSON.stringify(block.arguments ?? {});
      } catch {
        return "";
      }
    default:
      return "";
  }
}

function extractMessageText(message: Message): string {
  if (typeof message.content === "string") {
    return message.content;
  }
  if (Array.isArray(message.content)) {
    return message.content.map((b) => extractTextFromBlock(b as ContentBlock)).join("");
  }
  return "";
}

export function estimateTokens(input: string | Message[]): number {
  if (typeof input === "string") {
    return estimateString(input);
  }
  let combined = "";
  for (const message of input) {
    combined += extractMessageText(message);
  }
  return estimateString(combined);
}
