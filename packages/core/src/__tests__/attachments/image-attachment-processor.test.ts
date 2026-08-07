import { describe, it, expect, beforeEach, afterEach } from "vitest";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import { createImageAttachmentProcessor } from "../../attachments/image-processor.js";
import { attachmentProcessors } from "../../attachments/index.js";
import { AccessDeniedError } from "../../errors.js";

const PNG_BYTES = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
  0x89,
]);

describe("image attachment processor", () => {
  let tmpDir: string;
  let processor = createImageAttachmentProcessor();

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "wb-img-att-"));
    processor = createImageAttachmentProcessor();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("preprocess reads file under .spherse/attachments and returns base64 image block", async () => {
    const attachmentsDir = path.join(tmpDir, ".spherse", "attachments");
    fs.mkdirSync(attachmentsDir, { recursive: true });
    const filePath = path.join(attachmentsDir, "test.png");
    fs.writeFileSync(filePath, PNG_BYTES);

    const blocks = await processor.preprocess({
      projectRoot: tmpDir,
      attachment: {
        type: "image",
        path: ".spherse/attachments/test.png",
        mimeType: "image/png",
      },
    });

    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toEqual({
      type: "image",
      data: PNG_BYTES.toString("base64"),
      mimeType: "image/png",
    });
  });

  it("throws when path is outside .spherse/attachments (project root)", async () => {
    const rootFile = path.join(tmpDir, "evil.png");
    fs.writeFileSync(rootFile, PNG_BYTES);

    await expect(
      processor.preprocess({
        projectRoot: tmpDir,
        attachment: { type: "image", path: "evil.png", mimeType: "image/png" },
      }),
    ).rejects.toBeInstanceOf(AccessDeniedError);
  });

  it("throws when path is under a different .spherse subdir", async () => {
    const otherDir = path.join(tmpDir, ".spherse", "generated-images");
    fs.mkdirSync(otherDir, { recursive: true });
    fs.writeFileSync(path.join(otherDir, "x.png"), PNG_BYTES);

    await expect(
      processor.preprocess({
        projectRoot: tmpDir,
        attachment: {
          type: "image",
          path: ".spherse/generated-images/x.png",
          mimeType: "image/png",
        },
      }),
    ).rejects.toBeInstanceOf(AccessDeniedError);
  });

  it("throws on path traversal escaping the project root", async () => {
    await expect(
      processor.preprocess({
        projectRoot: tmpDir,
        attachment: { type: "image", path: "../outside.png", mimeType: "image/png" },
      }),
    ).rejects.toBeInstanceOf(AccessDeniedError);
  });

  it("is registered under the 'image' key in attachmentProcessors", () => {
    expect(attachmentProcessors.image).toBeDefined();
    expect(attachmentProcessors.image.type).toBe("image");
    expect(attachmentProcessors["nonexistent"]).toBeUndefined();
  });
});
