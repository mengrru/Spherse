import { parseChatServerEvent, type ChatReplayEvent } from "@spherse/contracts";
import { parseAgentEvent, type AgentEvent } from "../model/agent-event-parse";

export type DecodedFrame =
  | { kind: "event"; event: AgentEvent }
  | { kind: "session-ready"; lastSeq: number; replay: boolean }
  | { kind: "replay-events"; events: ChatReplayEvent[] }
  | { kind: "replay-done" }
  | { kind: "ignored" };

export function decodeServerFrame(raw: unknown): DecodedFrame {
  try {
    const parsed = parseChatServerEvent(raw);
    switch (parsed.type) {
      case "session_ready":
        return { kind: "session-ready", lastSeq: parsed.lastSeq, replay: parsed.replay };
      case "replay_events":
        return { kind: "replay-events", events: parsed.events };
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
