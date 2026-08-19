import type { AgentEvent, AgentMessage } from "@earendil-works/pi-agent-core";
import type { UserMessage } from "@earendil-works/pi-ai";
import type { EventMiddleware } from "../kernel/event-pipeline.js";
import {
  sanitizeAttachmentEvent,
  stripUserAttachments,
  type Attachment,
  type UserMessageWithAttachments,
} from "./index.js";

export interface AttachmentSanitizer {
  readonly middleware: EventMiddleware<AgentEvent>;
  finalize(messages: AgentMessage[]): {
    messages: AgentMessage[];
    pair: { full: AgentMessage; stripped: AgentMessage } | null;
  };
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
    finalize(messages) {
      if (!fullUserMsg || !strippedMsg) return { messages, pair: null };
      return {
        messages: messages.map((m) => (m === fullUserMsg ? (strippedMsg as AgentMessage) : m)),
        pair: { full: fullUserMsg as AgentMessage, stripped: strippedMsg as AgentMessage },
      };
    },
  };
}
