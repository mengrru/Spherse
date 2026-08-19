import type { AgentEvent, AgentMessage } from "@earendil-works/pi-agent-core";
import { logAgentEvent } from "./log-agent-event.js";
import type { EventMiddleware } from "../kernel/event-pipeline.js";
import type { Logger } from "../logger.js";

export function logEventMiddleware(logger: Logger): EventMiddleware<AgentEvent> {
  return (event, next) => {
    logAgentEvent(logger, event);
    next(event);
  };
}

export function persistEventMiddleware(
  append: (message: AgentMessage) => number | undefined,
): EventMiddleware<AgentEvent> {
  return (event, next) => {
    if (event.type === "message_end") {
      append(event.message);
    }
    next(event);
  };
}
