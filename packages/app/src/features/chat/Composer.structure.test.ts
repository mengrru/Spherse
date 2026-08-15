import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const currentDir = dirname(fileURLToPath(import.meta.url));

describe("Composer structure", () => {
  const source = readFileSync(join(currentDir, "Composer.tsx"), "utf8");

  it("passes an optional AttachedImage through onSend", () => {
    expect(source).toContain("image?: AttachedImage");
    expect(source).toMatch(/onSend\(message,\s*image \?\? undefined\)/);
  });

  it("renders a hidden image file input triggered by the attach button", () => {
    expect(source).toContain('type="file"');
    expect(source).toContain('accept="image/*"');
    expect(source).toContain("fileInputRef");
    expect(source).toContain("PaperclipIcon");
  });

  it("runs the compress -> upload pipeline and deletes on remove", () => {
    expect(source).toContain("compressImage");
    expect(source).toContain("uploadAttachedImage");
    expect(source).toContain("deleteAttachment");
  });

  it("tracks an idle/compressing/uploading/error status and disables send while busy", () => {
    expect(source).toContain('"compressing"');
    expect(source).toContain('"uploading"');
    expect(source).toMatch(/attachBusy|attachStatus/);
  });

  it("keeps the textarea editable while streaming and only disables it while loading", () => {
    expect(source).toContain("disabled={loading}");
    expect(source).not.toContain("disabled={streaming || loading}");
  });

  it("surfaces attach failures via the i18n toast", () => {
    expect(source).toContain("chat.imageAttachFailed");
    expect(source).toContain("toast.error");
  });
});
