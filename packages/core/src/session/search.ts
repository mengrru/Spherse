export interface MessageSearchMatch {
  role: "user" | "assistant";
  snippet: string;
}

export interface MessageSearchHit {
  sessionId: string;
  sessionTitle?: string;
  seq: number;
  role: "user" | "assistant";
  snippet: string;
  time: number;
}

export interface ProjectMessageSearchHit extends MessageSearchHit {
  agentId: string;
}

const SNIPPET_BEFORE = 30;
const SNIPPET_AFTER = 90;

export function escapeLikePattern(query: string): string {
  return query.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

export function extractSearchableText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const block of content) {
    if (
      typeof block === "object" &&
      block !== null &&
      (block as { type?: unknown }).type === "text" &&
      typeof (block as { text?: unknown }).text === "string"
    ) {
      parts.push((block as { text: string }).text);
    }
  }
  return parts.join("\n");
}

export function buildSnippet(text: string, matchIndex: number, matchLength: number): string {
  const start = Math.max(0, matchIndex - SNIPPET_BEFORE);
  const end = Math.min(text.length, matchIndex + matchLength + SNIPPET_AFTER);
  const prefix = start > 0 ? "…" : "";
  const suffix = end < text.length ? "…" : "";
  const collapsed = text.slice(start, end).replace(/\s+/g, " ").trim();
  return `${prefix}${collapsed}${suffix}`;
}

export function matchMessageData(query: string, dataJson: string): MessageSearchMatch | null {
  const trimmed = query.trim();
  if (!trimmed) return null;
  let data: { message?: { role?: unknown; content?: unknown } };
  try {
    data = JSON.parse(dataJson) as { message?: { role?: unknown; content?: unknown } };
  } catch {
    return null;
  }
  const message = data.message;
  if (typeof message !== "object" || message === null) return null;
  const role = message.role;
  if (role !== "user" && role !== "assistant") return null;
  const text = extractSearchableText(message.content);
  if (!text) return null;
  const index = text.toLowerCase().indexOf(trimmed.toLowerCase());
  if (index < 0) return null;
  return { role, snippet: buildSnippet(text, index, trimmed.length) };
}
