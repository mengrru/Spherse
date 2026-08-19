import { describe, expect, it, vi } from "vitest";

vi.mock("electron-store", () => ({
  default: class MockStore {
    private data: Record<string, unknown> = {};
    get(key: string) {
      return this.data[key];
    }
    set(key: string, value: unknown) {
      this.data[key] = value;
    }
  },
}));

vi.mock("electron", () => ({
  nativeTheme: { themeSource: "system" },
}));

import { maskModelGroup, mergeModelGroup, getMaskedSettings, saveSettings, settingsStore, getMobileAccess, setMobileAccess } from "./settings";
import { getAppModelCatalog } from "./model-catalog.js";

describe("mergeModelGroup sampling passthrough", () => {
  it("uses incoming sampling when present", () => {
    const result = mergeModelGroup(
      { defaultModel: "deepseek/v4", providers: {}, sampling: { temperature: 0.7, topP: 0.9 } },
      { defaultModel: "", providers: {}, sampling: { temperature: 0.3, topP: 0.1 } },
    );

    expect(result.sampling).toEqual({ temperature: 0.7, topP: 0.9 });
  });

  it("does not fall back to prev when incoming has no sampling", () => {
    const result = mergeModelGroup(
      { defaultModel: "deepseek/v4", providers: {} },
      { defaultModel: "", providers: {}, sampling: { temperature: 0.3 } },
    );

    expect(result.sampling).toBeUndefined();
  });

  it("is undefined when neither has sampling", () => {
    const result = mergeModelGroup(
      { defaultModel: "deepseek/v4", providers: {} },
      { defaultModel: "", providers: {} },
    );

    expect(result.sampling).toBeUndefined();
  });

  it("clears sampling when incoming is explicitly undefined", () => {
    const result = mergeModelGroup(
      { defaultModel: "deepseek/v4", providers: {}, sampling: undefined },
      { defaultModel: "", providers: {}, sampling: { temperature: 0.5 } },
    );

    expect(result.sampling).toBeUndefined();
  });
});

describe("maskModelGroup sampling passthrough", () => {
  it("preserves sampling without masking", () => {
    const result = maskModelGroup({
      defaultModel: "deepseek/v4",
      providers: { deepseek: { apiKey: "sk-secret-key-12345" } },
      sampling: { temperature: 0.4, topP: 0.5 },
    });

    expect(result.sampling).toEqual({ temperature: 0.4, topP: 0.5 });
    expect(result.providers.deepseek?.apiKey).toBe("sk-s****2345");
  });

  it("passes through undefined sampling", () => {
    const result = maskModelGroup({ defaultModel: "", providers: {} });

    expect(result.sampling).toBeUndefined();
  });
});

describe("theme persistence", () => {
  it("getMaskedSettings defaults theme to system when absent", () => {
    settingsStore.set("settings", {
      locale: "zh-CN",
      models: { text: { defaultModel: "", providers: {} }, image: { defaultModel: "", providers: {} } },
    });

    const masked = getMaskedSettings();

    expect(masked?.theme).toBe("system");
  });

  it("getMaskedSettings returns stored theme", () => {
    settingsStore.set("settings", {
      locale: "zh-CN",
      theme: "dark",
      models: { text: { defaultModel: "", providers: {} }, image: { defaultModel: "", providers: {} } },
    });

    expect(getMaskedSettings()?.theme).toBe("dark");
  });

  it("saveSettings defaults theme to system when not provided and no previous value", () => {
    settingsStore.set("settings", undefined);
    saveSettings({
      locale: "zh-CN",
      models: { text: { defaultModel: "", providers: {} }, image: { defaultModel: "", providers: {} } },
    });

    expect(settingsStore.get("settings")?.theme).toBe("system");
  });

  it("saveSettings preserves previous theme when incoming omits it", () => {
    settingsStore.set("settings", {
      locale: "zh-CN",
      theme: "light",
      models: { text: { defaultModel: "", providers: {} }, image: { defaultModel: "", providers: {} } },
    });

    saveSettings({
      locale: "zh-CN",
      models: { text: { defaultModel: "", providers: {} }, image: { defaultModel: "", providers: {} } },
    });

    expect(settingsStore.get("settings")?.theme).toBe("light");
  });
});

describe("customProviders persistence", () => {
  const customDef = {
    id: "my-openai",
    name: "My OpenAI",
    baseUrl: "https://api.example.com/v1",
    models: ["gpt-4o"],
    keyless: false,
  };

  it("saveSettings persists incoming customProviders", () => {
    settingsStore.set("settings", undefined);
    saveSettings({
      locale: "zh-CN",
      models: { text: { defaultModel: "", providers: {} }, image: { defaultModel: "", providers: {} } },
      customProviders: [customDef],
    });

    expect(settingsStore.get("settings")?.customProviders).toEqual([customDef]);
  });

  it("saveSettings preserves previous customProviders when incoming omits them", () => {
    settingsStore.set("settings", {
      locale: "zh-CN",
      customProviders: [customDef],
      models: { text: { defaultModel: "", providers: {} }, image: { defaultModel: "", providers: {} } },
    });

    saveSettings({
      locale: "zh-CN",
      models: { text: { defaultModel: "", providers: {} }, image: { defaultModel: "", providers: {} } },
    });

    expect(settingsStore.get("settings")?.customProviders).toEqual([customDef]);
  });

  it("saveSettings replaces customProviders wholesale when provided", () => {
    settingsStore.set("settings", {
      locale: "zh-CN",
      customProviders: [customDef],
      models: { text: { defaultModel: "", providers: {} }, image: { defaultModel: "", providers: {} } },
    });

    const updated = { ...customDef, name: "Renamed" };
    saveSettings({
      locale: "zh-CN",
      models: { text: { defaultModel: "", providers: {} }, image: { defaultModel: "", providers: {} } },
      customProviders: [updated],
    });

    expect(settingsStore.get("settings")?.customProviders).toEqual([updated]);
  });

  it("getMaskedSettings passes through customProviders unchanged", () => {
    settingsStore.set("settings", {
      locale: "zh-CN",
      customProviders: [customDef],
      models: { text: { defaultModel: "", providers: {} }, image: { defaultModel: "", providers: {} } },
    });

    const masked = getMaskedSettings();

    expect(masked?.customProviders).toEqual([customDef]);
  });

  it("getMaskedSettings defaults customProviders to empty array when absent", () => {
    settingsStore.set("settings", {
      locale: "zh-CN",
      models: { text: { defaultModel: "", providers: {} }, image: { defaultModel: "", providers: {} } },
    });

    const masked = getMaskedSettings();

    expect(masked?.customProviders).toEqual([]);
  });

  it("saveSettings registers custom providers into the core catalog via syncCustomProviders", () => {
    settingsStore.set("settings", undefined);
    saveSettings({
      locale: "zh-CN",
      models: { text: { defaultModel: "", providers: {} }, image: { defaultModel: "", providers: {} } },
      customProviders: [customDef],
    });

    const catalog = getAppModelCatalog().getSupportedProviders();
    expect(catalog["my-openai"]).toBeDefined();
    expect(catalog["my-openai"].custom).toBe(true);
    expect(catalog["my-openai"].baseUrl).toBe("https://api.example.com/v1");

    saveSettings({
      locale: "zh-CN",
      models: { text: { defaultModel: "", providers: {} }, image: { defaultModel: "", providers: {} } },
      customProviders: [],
    });
    expect(getAppModelCatalog().getSupportedProviders()["my-openai"]).toBeUndefined();
  });
});

describe("mobileAccess persistence", () => {
  it("getMobileAccess defaults mode to quick and other fields to empty", () => {
    settingsStore.set("settings", undefined);
    expect(getMobileAccess()).toEqual({ enabled: false, token: undefined, mode: "quick", publicDomain: undefined });
  });

  it("setMobileAccess round-trips mode and publicDomain", () => {
    settingsStore.set("settings", undefined);
    setMobileAccess({ enabled: true, token: "abc", mode: "manual", publicDomain: "https://spherse.example.com" });
    expect(getMobileAccess()).toEqual({
      enabled: true,
      token: "abc",
      mode: "manual",
      publicDomain: "https://spherse.example.com",
    });
  });

  it("setMobileAccess merges patch preserving untouched fields", () => {
    settingsStore.set("settings", undefined);
    setMobileAccess({ enabled: true, token: "abc", mode: "manual", publicDomain: "https://a.com" });
    setMobileAccess({ publicDomain: "https://b.com" });
    expect(getMobileAccess()).toEqual({
      enabled: true,
      token: "abc",
      mode: "manual",
      publicDomain: "https://b.com",
    });
  });

  it("saveSettings preserves existing mobileAccess (regression)", () => {
    settingsStore.set("settings", {
      locale: "zh-CN",
      models: { text: { defaultModel: "", providers: {} }, image: { defaultModel: "", providers: {} } },
      mobileAccess: { enabled: true, token: "tok", mode: "manual", publicDomain: "https://x.com" },
    });

    saveSettings({
      locale: "en",
      models: { text: { defaultModel: "", providers: {} }, image: { defaultModel: "", providers: {} } },
    });

    expect(settingsStore.get("settings")?.mobileAccess).toEqual({
      enabled: true,
      token: "tok",
      mode: "manual",
      publicDomain: "https://x.com",
    });
  });
});
