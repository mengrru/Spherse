import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

const currentDir = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(currentDir, "UnsupportedFileCard.tsx"), "utf8");

describe("UnsupportedFileCard structure", () => {
  it("reads projectRoot from context and the host bridge", () => {
    expect(source).toContain("useProjectCtx()");
    expect(source).toContain("useHostBridge()");
  });

  it("gates the button on the openFileExternal capability", () => {
    expect(source).toContain("bridge.capabilities.openFileExternal");
  });

  it("opens the file via the project host api", () => {
    expect(source).toContain("bridge.project?.openFileExternal(");
  });

  it("joins projectRoot + relative filePath into an absolute path", () => {
    expect(source).toContain("projectRoot");
    expect(source).toContain("filePath");
  });

  it("uses the unsupported i18n keys", () => {
    expect(source).toContain('t("content-browser.unsupported.title")');
    expect(source).toContain('t("content-browser.unsupported.description")');
    expect(source).toContain('t("content-browser.unsupported.openExternally")');
  });

  it("does not reference window.electronAPI directly", () => {
    expect(source).not.toContain("window.electronAPI");
  });

  it("uses semantic color tokens (no hardcoded colors)", () => {
    expect(source).toContain("text-muted-foreground");
    expect(source).not.toMatch(/text-\[#[0-9a-fA-F]+\]/);
    expect(source).not.toMatch(/bg-\[#[0-9a-fA-F]+\]/);
  });

  it("does not use dark: modifiers", () => {
    expect(source).not.toMatch(/dark:/);
  });
});
