import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

const currentDir = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(currentDir, "ThinkingLevelField.tsx"), "utf8");

describe("ThinkingLevelField structure", () => {
  it("renders a NativeSelect with the four generic levels", () => {
    expect(source).toContain("NativeSelect");
    expect(source).toContain('["off", "low", "medium", "high"]');
    expect(source).not.toContain('"xhigh"');
    expect(source).not.toContain('"max"');
  });

  it("defaults the select value to medium when undefined", () => {
    expect(source).toContain('value={value ?? "medium"}');
  });

  it("puts the hint in a tooltip next to the label", () => {
    expect(source).toContain("Tooltip");
    expect(source).toContain("TooltipContent");
    expect(source).toContain("InfoIcon");
    expect(source).toContain('aria-label={t("settings.models.thinkingLevelHint")}');
  });

  it("uses the thinkingLevel i18n keys for label and options", () => {
    expect(source).toContain('t("settings.models.thinkingLevel")');
    expect(source).toContain("t(`settings.models.thinkingLevel.${level}`)");
  });

  it("takes a single value/onChange pair typed with ThinkingLevel", () => {
    expect(source).toContain("value: ThinkingLevel | undefined");
    expect(source).toContain("onChange: (level: ThinkingLevel) => void");
  });

  it("uses semantic color tokens (no hardcoded colors)", () => {
    expect(source).toContain("text-muted-foreground");
    expect(source).not.toMatch(/text-\[#[0-9a-fA-F]+\]/);
    expect(source).not.toMatch(/bg-\[#[0-9a-fA-F]+\]/);
  });
});
