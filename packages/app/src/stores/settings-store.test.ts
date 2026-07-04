import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SettingsApi } from "../../features/settings/types";
import { useSettingsStore } from "./settings-store";

function createApi(overrides: Partial<SettingsApi> = {}): SettingsApi {
  return {
    getSupportedProviders: vi.fn().mockResolvedValue({}),
    getSettings: vi.fn().mockResolvedValue(null),
    saveSettings: vi.fn().mockResolvedValue({ success: true }),
    ...overrides,
  };
}

describe("useSettingsStore", () => {
  beforeEach(() => {
    useSettingsStore.setState({ locale: "zh-CN", debugToolsEnabled: false });
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
    });
  });
});
