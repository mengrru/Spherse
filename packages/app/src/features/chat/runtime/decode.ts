import {
  parseChatReplayEvent,
  parseChatServerEvent,
  type ChatReplayEvent,
} from "@spherse/contracts";
import { parseAgentEvent, type AgentEvent } from "../model/agent-event-parse";

export type DecodedFrame =
  | { kind: "event"; event: AgentEvent }
  | { kind: "session-ready"; lastSeq: number; replay: boolean }
  | { kind: "replay-events"; events: ChatReplayEvent[] }
  | { kind: "replay-done" }
  | { kind: "ignored" };

export function decodeServerFrame(raw: unknown): DecodedFrame {
  if (isReplayFrame(raw)) {
    return { kind: "replay-events", events: parseReplayEvents(raw.events) };
  }
  try {
    const parsed = parseChatServerEvent(raw);
    switch (parsed.type) {
      case "session_ready":
        return { kind: "session-ready", lastSeq: parsed.lastSeq, replay: parsed.replay };
      case "replay_done":
        return { kind: "replay-done" };
      default: {
        const event = parseAgentEvent(parsed);
        return event ? { kind: "event", event } : { kind: "ignored" };
      }
    }
  } catch (err) {
    console.warn("[chat-ws] unparseable ws event:", err);
    return { kind: "ignored" };
  }
}

function isReplayFrame(raw: unknown): raw is { events: unknown[] } {
  return (
    typeof raw === "object" &&
    raw !== null &&
    (raw as { type?: unknown }).type === "replay_events" &&
    Array.isArray((raw as { events?: unknown }).events)
  );
}

function parseReplayEvents(rawEvents: unknown[]): ChatReplayEvent[] {
  const events: ChatReplayEvent[] = [];
  let skipped = 0;
  for (const rawEvent of rawEvents) {
    try {
      events.push(parseChatReplayEvent(rawEvent));
    } catch {
      skipped += 1;
    }
  }
  if (skipped > 0) {
    console.warn(`[chat-ws] skipped ${skipped} unknown replay event(s)`);
  }
  return events;
}
