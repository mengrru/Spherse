import type { UserMessage } from "@earendil-works/pi-ai";
import type { AgentEvent } from "@earendil-works/pi-agent-core";
import type { AttachmentProcessor } from "../kernel/attachments.js";

export interface Attachment {
  type: string;
  path: string;
  mimeType: string;
  meta?: Record<string, unknown>;
}

export type { AttachmentProcessor, PreparedContentBlock } from "../kernel/attachments.js";

export type UserMessageWithAttachments = UserMessage & { _attachments?: ReadonlyArray<Attachment> };

export async function prepareAttachmentUserMessage(
  text: string,
  attachments: ReadonlyArray<Attachment>,
  projectRoot: string,
  processors: ReadonlyArray<AttachmentProcessor>,
): Promise<UserMessage> {
  const byType = new Map(processors.map((p) => [p.type, p]));
  const blocks = [];
  for (const att of attachments) {
    const proc = byType.get(att.type);
    if (!proc) throw new Error(`Unsupported attachment type: ${att.type}`);
    blocks.push(...(await proc.preprocess({ projectRoot, attachment: att })));
  }
  return {
    role: "user",
    content: [
      { type: "text", text },
      ...blocks.map((b) =>
        b.type === "image"
          ? { type: "image" as const, data: b.data, mimeType: b.mimeType }
          : { type: "text" as const, text: b.text },
      ),
    ],
    timestamp: Date.now(),
  };
}

export function stripUserAttachments(
  userMessage: UserMessage,
  attachments: ReadonlyArray<Attachment>,
): UserMessageWithAttachments {
  const originalTextBlocks =
    typeof userMessage.content === "string"
      ? [{ type: "text" as const, text: userMessage.content }]
      : userMessage.content.filter((c) => c.type === "text");
  return {
    ...userMessage,
    content: originalTextBlocks,
    _attachments: attachments,
  };
}

export function sanitizeAttachmentEvent(
  event: AgentEvent,
  fullUserMsg: UserMessage,
  stripped: UserMessageWithAttachments,
): AgentEvent {
  switch (event.type) {
    case "message_start":
    case "message_end":
    case "turn_end":
    case "message_update":
      return event.message === fullUserMsg ? { ...event, message: stripped } : event;
    case "agent_end":
      return {
        ...event,
        messages: event.messages.map((m) => (m === fullUserMsg ? stripped : m)),
      };
    default:
      return event;
  }
}
