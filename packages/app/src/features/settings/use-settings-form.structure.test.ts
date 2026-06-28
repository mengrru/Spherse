import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

const currentDir = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(currentDir, "use-settings-form.ts"), "utf8");

describe("useSettingsForm temperature wiring", () => {
  it("reads text temperature from settings on init", () => {
    expect(source).toContain("temperature: settings?.models?.text?.temperature");
  });

  it("includes temperature in the text group of the save payload", () => {
    expect(source).toContain("temperature: t.temperature");
  });

  it("omits temperature from the image group of the save payload", () => {
    const imageLine = source
      .split("\n")
      .find((l) => l.includes("image:") && l.includes("keysToProviders(i.apiKeys)"));
    expect(imageLine).toBeDefined();
    expect(imageLine).not.toContain("temperature");
  });

  it("exposes setTemperature / resetTemperature via makeGroup", () => {
    expect(source).toContain("setTemperature: async");
    expect(source).toContain("resetTemperature: async");
  });

  it("persists temperature immediately (data + save) like changeDefaultModel", () => {
    expect(source).toContain("const next = { ...data, temperature: value }");
    expect(source).toContain("const next = { ...data, temperature: undefined }");
  });

  it("preserves sibling fields (e.g. temperature) when disconnecting a provider", () => {
    expect(source).toContain(
      "const next = { ...data, apiKeys: nextKeys, defaultModel: nextModel }",
    );
  });

  it("does not read image temperature from settings on init", () => {
    expect(source).not.toContain("settings?.models?.image?.temperature");
  });
});
