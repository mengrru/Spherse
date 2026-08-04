import type { Message } from "@earendil-works/pi-ai";
import type { StreamFn } from "@earendil-works/pi-agent-core";
import type { TimePerceptionConfig } from "../types.js";

export function computePerceivedTime(
  realMs: number,
  config: TimePerceptionConfig,
): number {
  return config.startMs + (realMs - config.epochMs) * config.flowRate;
}

export function formatPerceivedTime(
  perceivedMs: number,
  timeZone?: string,
): string {
  const dt = new Intl.DateTimeFormat("en-US", {
    timeZone: timeZone ?? undefined,
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  return dt.format(new Date(perceivedMs));
}

export function buildTimePrefix(
  realMs: number,
  config: TimePerceptionConfig,
): string {
  const perceived = computePerceivedTime(realMs, config);
  const formatted = formatPerceivedTime(perceived, config.timeZone);
  return `<time>${formatted}</time>`;
}

export function isActiveTimePerception(
  config: TimePerceptionConfig | undefined,
): config is TimePerceptionConfig {
  return !!config && config.enabled && config.flowRate > 0;
}

export function wrapWithTimePerception(
  base: StreamFn,
  config: TimePerceptionConfig,
): StreamFn {
  return (model, context, options) => {
    const messages = injectTimePrefix(context.messages, config);
    return base(model, { ...context, messages }, options);
  };
}

function injectTimePrefix(
  messages: Message[],
  config: TimePerceptionConfig,
): Message[] {
  return messages.map((msg) => {
    if (msg.role !== "user") return msg;
    if (typeof msg.timestamp !== "number") return msg;
    const prefix = buildTimePrefix(msg.timestamp, config);
    return { ...msg, content: prependToContent(msg.content, prefix) } as Message;
  });
}

function prependToContent(content: unknown, prefix: string): unknown {
  if (typeof content === "string") {
    return `${prefix} ${content}`;
  }
  if (Array.isArray(content)) {
    const first = content[0];
    if (
      typeof first === "object" &&
      first !== null &&
      (first as { type?: unknown }).type === "text" &&
      typeof (first as { text?: unknown }).text === "string"
    ) {
      const textBlock = first as { type: "text"; text: string };
      return [
        { ...textBlock, text: `${prefix} ${textBlock.text}` },
        ...content.slice(1),
      ];
    }
    return [{ type: "text", text: prefix }, ...content];
  }
  return content;
}
