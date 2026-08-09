import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

const currentDir = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(currentDir, "ErrorMessageSection.tsx"), "utf8");

describe("ErrorMessageSection structure", () => {
  it("accepts an optional errorCode prop", () => {
    expect(source).toContain("errorCode?: ErrorEventCode");
    expect(source).toContain("errorCode");
  });

  it("imports ErrorEventCode from server contracts", () => {
    expect(source).toContain('from "@spherse/server/contracts"');
    expect(source).toContain("ErrorEventCode");
  });

  it("renders the i18n model-not-configured text when errorCode is ModelNotConfigured", () => {
    expect(source).toContain("ErrorEventCode.ModelNotConfigured");
    expect(source).toContain('t("chat.error.modelNotConfigured")');
  });

  it("falls back to the raw error for other codes", () => {
    expect(source).toMatch(/errorCode === ErrorEventCode\.ModelNotConfigured[\s\S]*: error/);
  });

  it("renders an open-settings button for Auth errors", () => {
    expect(source).toContain("ErrorEventCode.Auth");
    expect(source).toContain('t("chat.error.authFailed")');
    expect(source).toContain('data-chat-open-settings');
    expect(source).toContain('openSettings("models")');
  });

  it("uses the useI18n hook", () => {
    expect(source).toContain("useI18n()");
  });

  it("uses semantic destructive token (no hardcoded colors)", () => {
    expect(source).toContain("text-destructive");
    expect(source).not.toMatch(/text-\[#[0-9a-fA-F]+\]/);
    expect(source).not.toMatch(/bg-\[#[0-9a-fA-F]+\]/);
  });

  it("does not use dark: modifiers", () => {
    expect(source).not.toMatch(/dark:/);
  });
});
