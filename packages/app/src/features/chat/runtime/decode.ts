import { parseChatServerEvent } from "@spherse/contracts";
import { parseAgentEvent, type AgentEvent } from "../model/agent-event-parse";

export function decodeServerFrame(raw: unknown): AgentEvent | undefined {
  try {
    return parseAgentEvent(parseChatServerEvent(raw));
  } catch (err) {
    console.warn("[chat-ws] unparseable ws event:", err);
    return undefined;
  }
}
