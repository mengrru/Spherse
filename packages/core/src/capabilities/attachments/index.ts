import type { Capability } from "../../kernel/capability.js";
import type { AttachmentProcessor } from "../../attachments/index.js";
import { createImageAttachmentProcessor } from "../../attachments/image-processor.js";
import { attachmentContextProjector } from "./projector.js";

export function attachmentsCapability(processors?: ReadonlyArray<AttachmentProcessor>): Capability {
  const contributed = processors ?? [createImageAttachmentProcessor()];
  return {
    id: "attachments",
    attachmentProcessors: contributed,
    contextProjectors: [attachmentContextProjector],
  };
}
