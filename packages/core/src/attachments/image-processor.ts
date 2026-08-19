import fs from "node:fs/promises";
import path from "node:path";
import { resolveProjectPath, isPathInside } from "../utils/path-safety.js";
import { AccessDeniedError } from "../errors.js";
import { PROJECT_META_DIR } from "../types.js";
import type { AttachmentProcessor } from "../kernel/attachments.js";

const ATTACHMENTS_DIR = path.join(PROJECT_META_DIR, "attachments");

export function createImageAttachmentProcessor(): AttachmentProcessor {
  return {
    type: "image",
    async preprocess({ projectRoot, attachment }) {
      const root = path.resolve(projectRoot);
      const attachmentsRoot = path.resolve(root, ATTACHMENTS_DIR);
      const resolved = resolveProjectPath(root, attachment.path);
      if (!isPathInside(attachmentsRoot, resolved)) {
        throw new AccessDeniedError(
          `Attachment path must be inside ${ATTACHMENTS_DIR}/: ${attachment.path}`,
        );
      }
      const buf = await fs.readFile(resolved);
      return [
        { type: "image", data: buf.toString("base64"), mimeType: attachment.mimeType },
      ];
    },
  };
}
