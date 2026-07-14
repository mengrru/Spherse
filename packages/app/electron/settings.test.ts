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

import { maskModelGroup, mergeModelGroup, getMaskedSettings, saveSettings, settingsStore } from "./settings";

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
