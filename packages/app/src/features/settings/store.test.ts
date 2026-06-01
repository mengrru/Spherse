import { beforeEach, describe, expect, it, vi } from "vitest";
import { FALLBACK_MODEL_PROVIDERS, MODEL_PROVIDER_IDS } from "./types";
import type { SettingsApi } from "./types";
import { useSettingsStore } from "./store";

function createApi(overrides: Partial<SettingsApi> = {}): SettingsApi {
  return {
    getSupportedProviders: vi.fn().mockResolvedValue(FALLBACK_MODEL_PROVIDERS),
    getSettings: vi.fn().mockResolvedValue(null),
    saveSettings: vi.fn().mockResolvedValue({ success: true }),
    ...overrides,
  };
}

describe("useSettingsStore", () => {
  beforeEach(() => {
    useSettingsStore.setState({
      providers: {},
      apiKeys: {},
      defaultModel: "",
      saving: false,
      message: null,
    });
  });

  it("loads providers, api keys, and default model", async () => {
    const api = createApi({
      getSettings: vi.fn().mockResolvedValue({
        providers: {
          deepseek: { apiKey: " deepseek-key " },
          zai: { apiKey: "zai-key" },
        },
        defaultModel: "glm-5.1",
      }),
    });

    await useSettingsStore.getState().load(api);

    expect(api.getSupportedProviders).toHaveBeenCalledTimes(1);
    expect(api.getSettings).toHaveBeenCalledTimes(1);
    expect(useSettingsStore.getState().providers.deepseek.name).toBe("DeepSeek");
    expect(useSettingsStore.getState().apiKeys).toEqual({
      deepseek: " deepseek-key ",
      zai: "zai-key",
    });
    expect(useSettingsStore.getState().defaultModel).toBe("glm-5.1");
  });

  it("builds settings from tracked provider ids and trims api keys", async () => {
    const api = createApi();
    useSettingsStore.setState({
      apiKeys: { deepseek: " key ", unknown: "ignored" },
      defaultModel: "deepseek-v4-flash",
    });

    const ok = await useSettingsStore.getState().save(api);

    expect(ok).toBe(true);
    expect(api.saveSettings).toHaveBeenCalledWith({
      providers: {
        deepseek: { apiKey: "key" },
        zai: { apiKey: "" },
      },
      defaultModel: "deepseek-v4-flash",
    });
    expect(useSettingsStore.getState().message).toBe("saved");
    expect(useSettingsStore.getState().saving).toBe(false);
  });

  it("clears default model when disconnecting its provider", async () => {
    const api = createApi();
    useSettingsStore.setState({
      providers: FALLBACK_MODEL_PROVIDERS,
      apiKeys: { deepseek: "key", zai: "zai-key" },
      defaultModel: FALLBACK_MODEL_PROVIDERS.deepseek.models[0],
    });

    await useSettingsStore.getState().disconnect(api, "deepseek");

    expect(useSettingsStore.getState().apiKeys.deepseek).toBe("");
    expect(useSettingsStore.getState().defaultModel).toBe("");
    expect(api.saveSettings).toHaveBeenCalledTimes(1);
  });

  it("provides fallback model providers", () => {
    const providers = useSettingsStore.getState().getModelProviders();

    expect(Object.keys(providers)).toEqual([...MODEL_PROVIDER_IDS]);
    expect(providers.deepseek).toEqual(FALLBACK_MODEL_PROVIDERS.deepseek);
  });

  it("returns a stable model providers reference while providers are unchanged", () => {
    const first = useSettingsStore.getState().getModelProviders();
    const second = useSettingsStore.getState().getModelProviders();

    expect(second).toBe(first);
  });
});
