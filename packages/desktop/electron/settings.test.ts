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
  app: { isPackaged: false },
  nativeTheme: { themeSource: "system" },
}));

import { maskModelGroup, mergeModelGroup, getMaskedSettings, saveSettings, settingsStore, getCloseToTray, getMobileAccess, setMobileAccess, getServerToken, setServerToken, generateAccessToken } from "./settings.js";
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

describe("thinkingLevel persistence", () => {
  it("mergeModelGroup uses incoming thinkingLevel when present", () => {
    const result = mergeModelGroup(
      { defaultModel: "deepseek/v4", providers: {}, thinkingLevel: "high" },
      { defaultModel: "", providers: {}, thinkingLevel: "low" },
    );

    expect(result.thinkingLevel).toBe("high");
  });

  it("mergeModelGroup does not fall back to prev when incoming omits thinkingLevel", () => {
    const result = mergeModelGroup(
      { defaultModel: "deepseek/v4", providers: {} },
      { defaultModel: "", providers: {}, thinkingLevel: "low" },
    );

    expect(result.thinkingLevel).toBeUndefined();
  });

  it("maskModelGroup preserves thinkingLevel", () => {
    const result = maskModelGroup({
      defaultModel: "deepseek/v4",
      providers: {},
      thinkingLevel: "off",
    });

    expect(result.thinkingLevel).toBe("off");
  });

  it("getMaskedSettings returns stored thinkingLevel for text group", () => {
    settingsStore.set("settings", {
      locale: "zh-CN",
      models: {
        text: { defaultModel: "", providers: {}, thinkingLevel: "high" },
        image: { defaultModel: "", providers: {} },
      },
    });

    expect(getMaskedSettings()?.models.text.thinkingLevel).toBe("high");
  });

  it("saveSettings round-trips thinkingLevel through merge", () => {
    settingsStore.set("settings", undefined);
    saveSettings({
      locale: "zh-CN",
      models: {
        text: { defaultModel: "", providers: {}, thinkingLevel: "low" },
        image: { defaultModel: "", providers: {} },
      },
    });

    expect(settingsStore.get("settings")?.models.text.thinkingLevel).toBe("low");
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

describe("tabsEnabled persistence", () => {
  const models = { text: { defaultModel: "", providers: {} }, image: { defaultModel: "", providers: {} } };

  it("getMaskedSettings defaults tabsEnabled to true when absent", () => {
    settingsStore.set("settings", { locale: "zh-CN", models });
    expect(getMaskedSettings()?.tabsEnabled).toBe(true);
  });

  it("saveSettings defaults tabsEnabled to true when not provided and no previous value", () => {
    settingsStore.set("settings", undefined);
    saveSettings({ locale: "zh-CN", models });
    expect(settingsStore.get("settings")?.tabsEnabled).toBe(true);
  });

  it("saveSettings preserves previous tabsEnabled when incoming omits it", () => {
    settingsStore.set("settings", { locale: "zh-CN", tabsEnabled: false, models });
    saveSettings({ locale: "zh-CN", models });
    expect(settingsStore.get("settings")?.tabsEnabled).toBe(false);
    expect(getMaskedSettings()?.tabsEnabled).toBe(false);
  });
});

describe("systemNotifications persistence", () => {
  const models = { text: { defaultModel: "", providers: {} }, image: { defaultModel: "", providers: {} } };

  it("defaults systemNotifications to true when absent", () => {
    settingsStore.set("settings", { locale: "zh-CN", models });
    expect(getMaskedSettings()?.systemNotifications).toBe(true);
  });

  it("persists systemNotifications through saveSettings and masked read", () => {
    settingsStore.set("settings", undefined);
    saveSettings({ locale: "zh-CN", models, systemNotifications: false });
    expect(settingsStore.get("settings")?.systemNotifications).toBe(false);
    expect(getMaskedSettings()?.systemNotifications).toBe(false);
  });

  it("keeps previous systemNotifications when incoming omits it", () => {
    settingsStore.set("settings", { locale: "zh-CN", models, systemNotifications: false });
    saveSettings({ locale: "zh-CN", models });
    expect(settingsStore.get("settings")?.systemNotifications).toBe(false);
  });
});

describe("closeToTray persistence", () => {
  const models = { text: { defaultModel: "", providers: {} }, image: { defaultModel: "", providers: {} } };

  it("defaults closeToTray to true when absent", () => {
    settingsStore.set("settings", { locale: "zh-CN", models });
    expect(getMaskedSettings()?.closeToTray).toBe(true);
    expect(getCloseToTray()).toBe(true);
  });

  it("getCloseToTray defaults to true on fresh install", () => {
    settingsStore.set("settings", undefined);
    expect(getCloseToTray()).toBe(true);
  });

  it("saveSettings defaults closeToTray to true when not provided and no previous value", () => {
    settingsStore.set("settings", undefined);
    saveSettings({ locale: "zh-CN", models });
    expect(settingsStore.get("settings")?.closeToTray).toBe(true);
  });

  it("defaults closeToTray to false in an unpackaged dev run", () => {
    vi.stubEnv("NODE_ENV", "development");
    try {
      settingsStore.set("settings", undefined);
      expect(getCloseToTray()).toBe(false);
      saveSettings({ locale: "zh-CN", models });
      expect(settingsStore.get("settings")?.closeToTray).toBe(false);
      expect(getMaskedSettings()?.closeToTray).toBe(false);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("keeps an explicit closeToTray choice in an unpackaged dev run", () => {
    vi.stubEnv("NODE_ENV", "development");
    try {
      settingsStore.set("settings", { locale: "zh-CN", closeToTray: true, models });
      expect(getCloseToTray()).toBe(true);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("saveSettings preserves previous closeToTray when incoming omits it", () => {
    settingsStore.set("settings", { locale: "zh-CN", closeToTray: false, models });
    saveSettings({ locale: "zh-CN", models });
    expect(settingsStore.get("settings")?.closeToTray).toBe(false);
    expect(getMaskedSettings()?.closeToTray).toBe(false);
    expect(getCloseToTray()).toBe(false);
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

describe("serverToken", () => {
  it("generates and persists when nothing exists", () => {
    settingsStore.set("settings", undefined);
    settingsStore.set("serverToken", undefined);
    const token = getServerToken();
    expect(token).toBeTruthy();
    expect(settingsStore.get("serverToken")).toBe(token);
  });

  it("migrates from legacy mobileAccess.token", () => {
    settingsStore.set("settings", { mobileAccess: { enabled: true, token: "legacy-tok", mode: "quick" } });
    settingsStore.set("serverToken", undefined);
    expect(getServerToken()).toBe("legacy-tok");
    expect(settingsStore.get("serverToken")).toBe("legacy-tok");
  });

  it("prefers existing serverToken over legacy token", () => {
    settingsStore.set("settings", { mobileAccess: { enabled: true, token: "legacy-tok", mode: "quick" } });
    settingsStore.set("serverToken", "current-tok");
    expect(getServerToken()).toBe("current-tok");
  });

  it("setServerToken overwrites and getServerToken returns it", () => {
    settingsStore.set("serverToken", "a");
    setServerToken("b");
    expect(getServerToken()).toBe("b");
  });

  it("saveSettings does not drop serverToken (top-level key)", () => {
    settingsStore.set("serverToken", "keep-me");
    settingsStore.set("settings", undefined);
    saveSettings({
      locale: "en",
      models: { text: { defaultModel: "", providers: {} }, image: { defaultModel: "", providers: {} } },
    });
    expect(settingsStore.get("serverToken")).toBe("keep-me");
  });

  it("generateAccessToken produces distinct secrets", () => {
    expect(generateAccessToken()).not.toBe(generateAccessToken());
  });
});

describe("provider API keys in process env", () => {
  const empty = { defaultModel: "", providers: {} };

  function saveTextKeys(providers: Record<string, { apiKey: string }>) {
    saveSettings({ locale: "zh-CN", models: { text: { defaultModel: "", providers }, image: empty } });
  }

  it("clears a provider env key after it is removed from settings", () => {
    settingsStore.set("settings", undefined);
    delete process.env.DEEPSEEK_API_KEY;
    saveTextKeys({ deepseek: { apiKey: "sk-live" } });
    expect(process.env.DEEPSEEK_API_KEY).toBe("sk-live");

    saveTextKeys({ deepseek: { apiKey: "" } });
    expect(process.env.DEEPSEEK_API_KEY).toBeUndefined();
  });

  it("restores a pre-existing shell env value when the settings key is removed", () => {
    settingsStore.set("settings", undefined);
    process.env.DEEPSEEK_API_KEY = "sk-from-shell";
    saveTextKeys({ deepseek: { apiKey: "sk-settings" } });
    expect(process.env.DEEPSEEK_API_KEY).toBe("sk-settings");

    saveTextKeys({});
    expect(process.env.DEEPSEEK_API_KEY).toBe("sk-from-shell");
    delete process.env.DEEPSEEK_API_KEY;
  });

  it("keeps a shared env key while another provider still sets it", () => {
    settingsStore.set("settings", undefined);
    delete process.env.MOONSHOT_API_KEY;
    saveTextKeys({ moonshotai: { apiKey: "sk-a" }, "moonshotai-cn": { apiKey: "sk-b" } });
    saveTextKeys({ moonshotai: { apiKey: "" }, "moonshotai-cn": { apiKey: "sk-b****" } });
    expect(process.env.MOONSHOT_API_KEY).toBe("sk-b");
    saveTextKeys({});
    expect(process.env.MOONSHOT_API_KEY).toBeUndefined();
  });
});
