import type { DebugSessionEventContract } from "@spherse/contracts";

type BadgeVariant = "default" | "secondary" | "destructive" | "outline";

const EVENT_BADGE_VARIANTS: Record<string, BadgeVariant> = {
  "user/message": "default",
  "assistant/message": "secondary",
  "tool/result": "outline",
  "turn/start": "outline",
  "turn/end": "outline",
  "compaction/applied": "secondary",
  "turn/retried": "destructive",
  "turn/withdrawn": "destructive",
  "control/requested": "outline",
  "control/resolved": "outline",
};

export function eventBadgeVariant(type: string): BadgeVariant {
  return EVENT_BADGE_VARIANTS[type] ?? "outline";
}

interface ContentBlock {
  type?: unknown;
  text?: unknown;
  name?: unknown;
}

function snippet(value: string, max = 96): string {
  const one = value.replace(/\s+/g, " ").trim();
  return one.length > max ? `${one.slice(0, max)}…` : one;
}

function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter(
      (block): block is { type: string; text: string } =>
        typeof block === "object" &&
        block !== null &&
        (block as ContentBlock).type === "text" &&
        typeof (block as ContentBlock).text === "string",
    )
    .map((block) => block.text)
    .join(" ");
}

function toolCallsOf(content: unknown): string[] {
  if (!Array.isArray(content)) return [];
  return content
    .filter(
      (block): block is { type: string; name: string } =>
        typeof block === "object" &&
        block !== null &&
        (block as ContentBlock).type === "toolCall" &&
        typeof (block as ContentBlock).name === "string",
    )
    .map((block) => block.name);
}

function messagePreview(message: unknown): string {
  if (typeof message !== "object" || message === null) return "";
  const m = message as {
    role?: unknown;
    content?: unknown;
    toolName?: unknown;
    isError?: unknown;
    stopReason?: unknown;
  };
  const parts: string[] = [];
  if (typeof m.role === "string") parts.push(m.role);
  if (typeof m.toolName === "string") parts.push(m.toolName);
  const text = textOf(m.content);
  if (text) parts.push(snippet(text));
  const toolCalls = toolCallsOf(m.content);
  if (toolCalls.length > 0) parts.push(snippet(toolCalls.join(", ")));
  if (m.isError === true) parts.push("error");
  if (typeof m.stopReason === "string") parts.push(`stop: ${m.stopReason}`);
  return parts.join(" · ");
}

export function eventPreview(event: DebugSessionEventContract): string {
  const data = (event.data ?? {}) as Record<string, unknown>;
  switch (event.type) {
    case "user/message":
    case "assistant/message":
    case "tool/result":
      return messagePreview(data.message);
    case "turn/end":
      return `reason: ${String(data.reason ?? "")}`;
    case "compaction/applied":
      return `anchorSeq: ${String(data.anchorSeq)} · ${snippet(String(data.digestContent ?? ""))}`;
    case "turn/retried":
      return `abandoned: ${(Array.isArray(data.abandonedSeqs) ? data.abandonedSeqs : []).join(", ")}`;
    case "turn/withdrawn":
      return `seq: ${String(data.seq)}`;
    case "control/requested":
      return `${String(data.kind)} · ${String(data.toolName ?? "")}`;
    case "control/resolved":
      return data.kind === "approval"
        ? `approval · approved: ${String(data.approved)}`
        : `question · ${snippet(String(data.answer ?? ""))}`;
    case "turn/start":
      return "";
    default:
      return snippet(JSON.stringify(data));
  }
}
