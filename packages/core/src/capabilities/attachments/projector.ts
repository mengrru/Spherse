import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { ContextProjector } from "../../kernel/capability.js";

const STRIP_ROLES = new Set(["user", "assistant", "toolResult"]);

export const attachmentContextProjector: ContextProjector = () => {
  return (messages) => {
    const projected: AgentMessage[] = [];
    for (const message of messages) {
      if (!STRIP_ROLES.has(message.role)) continue;
      if (message.role === "user") {
        const { _attachments, ...rest } = message as typeof message & {
          _attachments?: unknown;
        };
        const content = (rest as { content?: unknown }).content;
        if (Array.isArray(content)) {
          (rest as { content: unknown[] }).content = content.filter(
            (c) => !(c && typeof c === "object" && (c as { type?: string }).type === "image" && !(c as { data?: unknown }).data),
          );
        }
        projected.push(rest as AgentMessage);
        continue;
      }
      projected.push(message);
    }
    return projected;
  };
};
