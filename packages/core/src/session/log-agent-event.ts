import type { AgentEvent } from "@earendil-works/pi-agent-core";
import type { Logger } from "../logger.js";

const TRUNCATE_LIMIT = 500;

function truncate(value: unknown): string {
  const str = typeof value === "string" ? value : JSON.stringify(value);
  if (!str) return "";
  return str.length > TRUNCATE_LIMIT ? str.slice(0, TRUNCATE_LIMIT) : str;
}

export function logAgentEvent(logger: Logger, event: AgentEvent): void {
  switch (event.type) {
    case "agent_start":
      logger.info({ event: event.type }, "agent run started");
      break;
    case "agent_end":
      logger.info({ event: event.type }, "agent run ended");
      break;
    case "turn_start":
      logger.debug({ event: event.type }, "turn started");
      break;
    case "turn_end":
      logger.debug(
        { event: event.type, toolCount: event.toolResults?.length ?? 0 },
        "turn ended",
      );
      break;
    case "message_start":
      logger.debug(
        { event: event.type, messageId: (event.message as any)?.id },
        "message streaming",
      );
      break;
    case "message_end":
      logger.debug({ event: event.type }, "message complete");
      break;
    case "message_update":
      break;
    case "tool_execution_start":
      logger.info(
        {
          event: event.type,
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          args: truncate(event.args),
        },
        "tool started",
      );
      break;
    case "tool_execution_end":
      logger.info(
        {
          event: event.type,
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          isError: event.isError,
          resultSummary: truncate(event.result),
        },
        "tool completed",
      );
      break;
    case "tool_execution_update":
      logger.trace(
        {
          event: event.type,
          toolCallId: event.toolCallId,
          partialResult: truncate(event.partialResult),
        },
        "tool partial",
      );
      break;
  }
}
