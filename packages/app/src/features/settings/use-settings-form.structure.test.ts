import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

const currentDir = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(currentDir, "use-settings-form.ts"), "utf8");

describe("useSettingsForm sampling wiring", () => {
  it("reads text sampling from settings on init", () => {
    expect(source).toContain("sampling: settings?.models?.text?.sampling");
  });

  it("includes sampling in the text group of the save payload", () => {
    expect(source).toContain("sampling: t.sampling");
  });

  it("omits sampling from the image group of the save payload", () => {
    const imageLine = source
      .split("\n")
      .find((l) => l.includes("image:") && l.includes("keysToProviders(i.apiKeys)"));
    expect(imageLine).toBeDefined();
    expect(imageLine).not.toContain("sampling");
  });

  it("exposes a single patchSampling (no setTemperature/resetTemperature/setTopP/resetTopP)", () => {
    expect(source).toContain("patchSampling: async");
    expect(source).not.toContain("setTemperature: async");
    expect(source).not.toContain("setTopP: async");
  });

  it("persists sampling immediately via mergeSampling + save", () => {
    expect(source).toContain("mergeSampling(data.sampling, params)");
  });

  it("preserves sampling (via spread of data) when disconnecting a provider", () => {
    expect(source).toContain(
      "const next = { ...data, apiKeys: nextKeys, defaultModel: nextModel }",
    );
  });

  it("does not read image sampling from settings on init", () => {
    expect(source).not.toContain("settings?.models?.image?.sampling");
  });
});
