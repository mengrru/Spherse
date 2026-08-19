import type { AgentEvent, AgentMessage } from "@earendil-works/pi-agent-core";
import type { UserMessage } from "@earendil-works/pi-ai";
import { logAgentEvent } from "../engine/log-agent-event.js";
import type { EventMiddleware } from "../kernel/event-pipeline.js";
import type { Logger } from "../logger.js";
import {
  sanitizeAttachmentEvent,
  stripUserAttachments,
  type Attachment,
  type UserMessageWithAttachments,
} from "../attachments/index.js";

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

export function forwardEventMiddleware(
  sink: (event: AgentEvent) => void,
): EventMiddleware<AgentEvent> {
  return (event, next) => {
    sink(event);
    next(event);
  };
}

export interface AttachmentSanitizer {
  readonly middleware: EventMiddleware<AgentEvent>;
  restoreStripped(messages: AgentMessage[]): AgentMessage[];
  replacementPair(): { full: AgentMessage; stripped: AgentMessage } | null;
}

export function createAttachmentSanitizer(
  attachments: ReadonlyArray<Attachment>,
): AttachmentSanitizer | null {
  if (attachments.length === 0) return null;

  let fullUserMsg: UserMessage | undefined;
  let strippedMsg: UserMessageWithAttachments | undefined;

  return {
    middleware(event, next) {
      if (
        !fullUserMsg &&
        event.type === "message_start" &&
        (event.message as UserMessage).role === "user"
      ) {
        fullUserMsg = event.message as UserMessage;
        strippedMsg = stripUserAttachments(fullUserMsg, attachments);
      }
      if (fullUserMsg && strippedMsg) {
        next(sanitizeAttachmentEvent(event, fullUserMsg, strippedMsg));
        return;
      }
      next(event);
    },
    restoreStripped(messages) {
      if (!fullUserMsg || !strippedMsg) return messages;
      return messages.map((m) => (m === fullUserMsg ? (strippedMsg as AgentMessage) : m));
    },
    replacementPair() {
      if (!fullUserMsg || !strippedMsg) return null;
      return { full: fullUserMsg as AgentMessage, stripped: strippedMsg as AgentMessage };
    },
  };
}
