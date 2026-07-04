interface RawMessage {
  role?: string;
  content?: unknown;
}

interface TextPart {
  type: "text";
  text: string;
}

export function extractMessageText(message: RawMessage): string {
  const content = message.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter((part: unknown): part is TextPart => isTextPart(part))
      .map((part) => part.text)
      .join("");
  }
  return "";
}

function isTextPart(part: unknown): part is TextPart {
  return typeof part === "object" && part !== null && (part as { type?: unknown }).type === "text";
}

export function formatSessionAsPlainText(
  messages: unknown[],
  title: string,
  assistantName?: string,
): string {
  const heading = title.trim() || "Session";
  const assistantLabel = (assistantName ?? "").trim() || "Assistant";
  const lines: string[] = [`# ${heading}`, ""];
  for (const raw of messages) {
    const message = raw as RawMessage;
    if (message.role !== "user" && message.role !== "assistant") continue;
    const text = extractMessageText(message);
    if (!text) continue;
    const label = message.role === "user" ? "User" : assistantLabel;
    lines.push(`[${label}]:`, text, "");
  }
  return `${lines.join("\n").trimEnd()}\n`;
}

function pad2(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}

export function formatExportTimestamp(date: Date): string {
  return (
    `${date.getFullYear()}${pad2(date.getMonth() + 1)}${pad2(date.getDate())}` +
    `-${pad2(date.getHours())}${pad2(date.getMinutes())}`
  );
}

const FILENAME_INVALID_CHARS = /[\\/:*?"<>|]/g;

export function buildExportFilename(agentSlug: string, date: Date): string {
  const prefix = agentSlug.trim().replace(FILENAME_INVALID_CHARS, "_").slice(0, 60) || "session";
  return `${prefix}-${formatExportTimestamp(date)}.txt`;
}

export function downloadTextFile(filename: string, content: string): void {
  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}
