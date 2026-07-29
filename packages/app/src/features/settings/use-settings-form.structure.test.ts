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

describe("useSettingsForm api key persistence", () => {
  it("exposes commitApiKey on the group form state", () => {
    expect(source).toContain("commitApiKey: (id: string, value: string) => void");
  });

  it("commitApiKey persists the key by saving the updated apiKeys (not only local state)", () => {
    expect(source).toContain("commitApiKey: (id, value) => {");
    expect(source).toContain(
      "const next = { ...data, apiKeys: { ...data.apiKeys, [id]: value } }",
    );
  });
});

describe("useSettingsForm custom provider wiring", () => {
  it("reads customProviders from settings on init", () => {
    expect(source).toContain("setCustomProviders(settings?.customProviders ?? [])");
  });

  it("includes customProviders in the save payload", () => {
    expect(source).toContain("customProviders: cp");
  });

  it("accepts a customProvidersOverride param on save", () => {
    expect(source).toContain("customProvidersOverride?: CustomProviderDef[]");
    expect(source).toContain("const cp = customProvidersOverride ?? customProviders");
  });

  it("exposes customProviders and the three mutation methods on the text group", () => {
    expect(source).toMatch(/text:\s*\{/);
    expect(source).toContain("customProviders,");
    expect(source).toContain("addCustomProvider,");
    expect(source).toContain("updateCustomProvider,");
    expect(source).toContain("removeCustomProvider,");
  });

  it("addCustomProvider generates an id and refreshes the catalog on success", () => {
    expect(source).toContain("generateCustomProviderId(def.name, existingIds)");
    expect(source).toContain("const existingIds = [...Object.keys(textProviders), ...customProviders.map((c) => c.id)]");
    expect(source).toContain("if (ok) await refreshTextCatalog();");
  });

  it("refreshTextCatalog refetches supported providers", () => {
    expect(source).toContain("const textCatalog = await api.getSupportedProviders();");
    expect(source).toContain("setTextProviders(textCatalog ?? {})");
  });

  it("updateCustomProvider keeps the id stable", () => {
    expect(source).toContain(
      "customProviders.map((c) => (c.id === id ? { ...def, id } : c))",
    );
  });

  it("removeCustomProvider clears apiKey and defaultModel referencing the provider", () => {
    expect(source).toContain("customProviders.filter((c) => c.id !== id)");
    expect(source).toContain("delete nextApiKeys[id];");
    expect(source).toContain(
      'textData.defaultModel.startsWith(`${id}/`) ? "" : textData.defaultModel',
    );
  });

  it("does not expose custom provider methods on the image group", () => {
    const imageLine = source
      .split("\n")
      .find((l) => l.includes('image: makeGroup("image"'));
    expect(imageLine).toBeDefined();
  });
});
