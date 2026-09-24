import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SettingsApi } from "../features/settings/types";
import { useSettingsStore } from "./settings-store";

function createApi(overrides: Partial<SettingsApi> = {}): SettingsApi {
  return {
    getSupportedProviders: vi.fn().mockResolvedValue({}),
    getImageProviders: vi.fn().mockResolvedValue({}),
    getSettings: vi.fn().mockResolvedValue(null),
    saveSettings: vi.fn().mockResolvedValue({ success: true }),
    ...overrides,
  };
}

describe("useSettingsStore", () => {
  beforeEach(() => {
    useSettingsStore.setState({ loaded: false, locale: "zh-CN", debugToolsEnabled: false, tabsEnabled: true, closeToTray: true, theme: "system" });
  });

  it("loads locale from settings", async () => {
    const api = createApi({
      getSettings: vi.fn().mockResolvedValue({ locale: "en" }),
    });

    await useSettingsStore.getState().loadLocale(api);

    expect(useSettingsStore.getState().locale).toBe("en");
  });

  it("defaults to zh-CN when no locale in settings", async () => {
    const api = createApi();

    await useSettingsStore.getState().loadLocale(api);

    expect(useSettingsStore.getState().locale).toBe("zh-CN");
  });

  it("changeLocale updates locale and persists", async () => {
    const models = {
      text: { defaultModel: "deepseek/v4", providers: { deepseek: { apiKey: "key" } } },
      image: { defaultModel: "", providers: {} },
    };
    const api = createApi({
      getSettings: vi.fn().mockResolvedValue({ models }),
    });

    const ok = await useSettingsStore.getState().changeLocale(api, "en");

    expect(ok).toBe(true);
    expect(useSettingsStore.getState().locale).toBe("en");
    expect(api.saveSettings).toHaveBeenCalledWith({
      locale: "en",
      models,
      debugToolsEnabled: false,
      tabsEnabled: true,
      closeToTray: true,
      theme: "system",
    });
  });

  it("loads debugToolsEnabled from settings", async () => {
    const api = createApi({
      getSettings: vi.fn().mockResolvedValue({ debugToolsEnabled: true }),
    });

    await useSettingsStore.getState().loadLocale(api);

    expect(useSettingsStore.getState().debugToolsEnabled).toBe(true);
  });

  it("defaults debugToolsEnabled to false when absent", async () => {
    const api = createApi();

    await useSettingsStore.getState().loadLocale(api);

    expect(useSettingsStore.getState().debugToolsEnabled).toBe(false);
  });

  it("setDebugToolsEnabled updates state and persists", async () => {
    const api = createApi({
      getSettings: vi.fn().mockResolvedValue({ locale: "zh-CN", models: undefined }),
    });

    const ok = await useSettingsStore.getState().setDebugToolsEnabled(api, true);

    expect(ok).toBe(true);
    expect(useSettingsStore.getState().debugToolsEnabled).toBe(true);
    expect(api.saveSettings).toHaveBeenCalledWith({
      locale: "zh-CN",
      models: undefined,
      debugToolsEnabled: true,
      tabsEnabled: true,
      closeToTray: true,
      theme: "system",
    });
  });

  it("loads theme from settings", async () => {
    const api = createApi({
      getSettings: vi.fn().mockResolvedValue({ theme: "dark" }),
    });

    await useSettingsStore.getState().loadLocale(api);

    expect(useSettingsStore.getState().theme).toBe("dark");
  });

  it("defaults theme to system when absent", async () => {
    const api = createApi();

    await useSettingsStore.getState().loadLocale(api);

    expect(useSettingsStore.getState().theme).toBe("system");
  });

  it("setTheme updates state and persists", async () => {
    const api = createApi({
      getSettings: vi.fn().mockResolvedValue({ locale: "zh-CN", models: undefined }),
    });

    const ok = await useSettingsStore.getState().setTheme(api, "dark");

    expect(ok).toBe(true);
    expect(useSettingsStore.getState().theme).toBe("dark");
    expect(api.saveSettings).toHaveBeenCalledWith({
      locale: "zh-CN",
      models: undefined,
      debugToolsEnabled: false,
      tabsEnabled: true,
      closeToTray: true,
      theme: "dark",
    });
  });

  it("setTheme preserves existing debugToolsEnabled and locale", async () => {
    useSettingsStore.setState({ locale: "en", debugToolsEnabled: true });
    const api = createApi({
      getSettings: vi.fn().mockResolvedValue({ locale: "en", models: undefined }),
    });

    await useSettingsStore.getState().setTheme(api, "light");

    expect(api.saveSettings).toHaveBeenCalledWith({
      locale: "en",
      models: undefined,
      debugToolsEnabled: true,
      tabsEnabled: true,
      closeToTray: true,
      theme: "light",
    });
  });

  it("defaults tabsEnabled to true and marks loaded", async () => {
    await useSettingsStore.getState().loadLocale(createApi());

    expect(useSettingsStore.getState().tabsEnabled).toBe(true);
    expect(useSettingsStore.getState().loaded).toBe(true);
  });

  it("loads tabsEnabled from settings", async () => {
    await useSettingsStore.getState().loadLocale(createApi({
      getSettings: vi.fn().mockResolvedValue({ tabsEnabled: false }),
    }));

    expect(useSettingsStore.getState().tabsEnabled).toBe(false);
  });

  it("setTabsEnabled updates state and persists all known fields", async () => {
    useSettingsStore.setState({ debugToolsEnabled: true, theme: "dark" });
    const api = createApi({
      getSettings: vi.fn().mockResolvedValue({ locale: "en", models: undefined }),
    });

    const ok = await useSettingsStore.getState().setTabsEnabled(api, false);

    expect(ok).toBe(true);
    expect(useSettingsStore.getState().tabsEnabled).toBe(false);
    expect(api.saveSettings).toHaveBeenCalledWith({
      locale: "en",
      models: undefined,
      debugToolsEnabled: true,
      tabsEnabled: false,
      closeToTray: true,
      theme: "dark",
    });
  });

  it("other setters preserve tabsEnabled", async () => {
    useSettingsStore.setState({ tabsEnabled: false });
    const api = createApi();

    await useSettingsStore.getState().setTheme(api, "light");

    expect(api.saveSettings).toHaveBeenCalledWith(expect.objectContaining({ tabsEnabled: false }));
  });

  it("defaults closeToTray to true and loads it from settings", async () => {
    await useSettingsStore.getState().loadLocale(createApi());
    expect(useSettingsStore.getState().closeToTray).toBe(true);

    await useSettingsStore.getState().loadLocale(createApi({
      getSettings: vi.fn().mockResolvedValue({ closeToTray: false }),
    }));
    expect(useSettingsStore.getState().closeToTray).toBe(false);
  });

  it("setCloseToTray updates state and persists", async () => {
    const api = createApi();

    const ok = await useSettingsStore.getState().setCloseToTray(api, false);

    expect(ok).toBe(true);
    expect(useSettingsStore.getState().closeToTray).toBe(false);
    expect(api.saveSettings).toHaveBeenCalledWith(expect.objectContaining({ closeToTray: false, tabsEnabled: true }));
  });

  it("other setters preserve closeToTray", async () => {
    useSettingsStore.setState({ closeToTray: false });
    const api = createApi();

    await useSettingsStore.getState().setTabsEnabled(api, false);

    expect(api.saveSettings).toHaveBeenCalledWith(expect.objectContaining({ closeToTray: false }));
  });
});
