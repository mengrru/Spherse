import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

const currentDir = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(currentDir, "AdvancedSettings.tsx"), "utf8");

describe("AdvancedSettings structure", () => {
  it("uses the Collapsible primitives", () => {
    expect(source).toContain("Collapsible");
    expect(source).toContain("CollapsibleTrigger");
    expect(source).toContain("CollapsibleContent");
  });

  it("is collapsed by default", () => {
    expect(source).toContain("useState(false)");
  });

  it("renders the temperature input with number constraints", () => {
    expect(source).toContain('type="number"');
    expect(source).toContain("min={0}");
    expect(source).toContain("step={0.1}");
  });

  it("commits on blur via parseTemperature (not on every keystroke)", () => {
    expect(source).toContain("onBlur");
    expect(source).toContain("parseTemperature(localValue)");
    expect(source).toContain('onChange={(e) => setLocalValue(e.target.value)}');
  });

  it("wires the reset button to onReset", () => {
    expect(source).toContain('onClick={onReset}');
  });

  it("wires setTemperature via the onSetTemperature prop", () => {
    expect(source).toContain("onSetTemperature");
  });

  it("uses the advanced/temperature i18n keys", () => {
    expect(source).toContain('t("settings.models.advanced")');
    expect(source).toContain('t("settings.models.advancedTip")');
    expect(source).toContain('t("settings.models.temperature")');
    expect(source).toContain('t("settings.models.temperaturePlaceholder")');
    expect(source).toContain('t("settings.models.temperatureHint")');
    expect(source).toContain('t("settings.models.temperatureReset")');
  });

  it("uses a chevron icon that rotates when open", () => {
    expect(source).toContain("ChevronDownIcon");
    expect(source).toContain("rotate(180deg)");
  });

  it("uses semantic color tokens (no hardcoded colors)", () => {
    expect(source).toContain("text-muted-foreground");
    expect(source).not.toMatch(/text-\[#[0-9a-fA-F]+\]/);
    expect(source).not.toMatch(/bg-\[#[0-9a-fA-F]+\]/);
  });
});
