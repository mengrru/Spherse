import type { Capability } from "../../kernel/capability.js";
import type { AttachmentProcessor } from "../../kernel/attachments.js";
import { createImageAttachmentProcessor } from "../../attachments/image-processor.js";

export function attachmentsCapability(processors?: ReadonlyArray<AttachmentProcessor>): Capability {
  const contributed = processors ?? [createImageAttachmentProcessor()];
  return {
    id: "attachments",
    attachmentProcessors: contributed,
  };
}
