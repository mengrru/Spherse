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

  it("takes a single sampling prop plus onSetSampling (not per-param props)", () => {
    expect(source).toContain("sampling?: SamplingParams");
    expect(source).toContain("onSetSampling: (params: SamplingParams) => void");
    expect(source).not.toContain("onSetTemperature");
    expect(source).not.toContain("onResetTemperature");
    expect(source).not.toContain("onSetTopP");
    expect(source).not.toContain("onResetTopP");
  });

  it("uses a reusable ParamField with number input constraints", () => {
    expect(source).toContain("function ParamField");
    expect(source).toContain('type="number"');
    expect(source).toContain("min={config.min}");
    expect(source).toContain("max={config.max}");
    expect(source).toContain("step={config.step}");
  });

  it("commits on blur via config.parse (not on every keystroke)", () => {
    expect(source).toContain("onBlur={handleBlur}");
    expect(source).toContain("config.parse(local)");
    expect(source).toContain('onChange={(e) => setLocal(e.target.value)}');
  });

  it("puts the hint in a tooltip next to the label (not as a paragraph below)", () => {
    expect(source).toContain("FieldLabel");
    expect(source).toContain("Tooltip");
    expect(source).toContain("TooltipTrigger");
    expect(source).toContain("TooltipContent");
    expect(source).toContain("InfoIcon");
    expect(source).toContain("aria-label={config.hint}");
  });

  it("resets a field via onSet(undefined) rather than a dedicated onReset prop", () => {
    expect(source).toContain("onClick={() => onSet(undefined)}");
    expect(source).not.toContain("onClick={onReset}");
  });

  it("renders both temperature and topP ParamField instances reading from sampling", () => {
    expect(source).toContain("sampling?.temperature");
    expect(source).toContain("sampling?.topP");
    expect(source).toContain("onSetSampling({ temperature: v })");
    expect(source).toContain("onSetSampling({ topP: v })");
  });

  it("constrains topP to 0–1 (max: 1) while temperature has no max", () => {
    expect(source).toContain("max: 1");
  });

  it("uses parseTemperature and parseTopP in the field configs", () => {
    expect(source).toContain("parseTemperature");
    expect(source).toContain("parseTopP");
  });

  it("uses the advanced/temperature/topP i18n keys", () => {
    expect(source).toContain('t("settings.models.advanced")');
    expect(source).toContain('t("settings.models.advancedTip")');
    expect(source).toContain('t("settings.models.temperature")');
    expect(source).toContain('t("settings.models.temperaturePlaceholder")');
    expect(source).toContain('t("settings.models.temperatureHint")');
    expect(source).toContain('t("settings.models.temperatureReset")');
    expect(source).toContain('t("settings.models.topP")');
    expect(source).toContain('t("settings.models.topPPlaceholder")');
    expect(source).toContain('t("settings.models.topPHint")');
    expect(source).toContain('t("settings.models.topPReset")');
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
