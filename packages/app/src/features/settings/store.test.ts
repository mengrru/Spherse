import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ProviderCatalogItem } from "@spherse/core";
import type { SettingsApi } from "./types";
import { useSettingsStore } from "./store";

const mockProvider = (id: string, name: string, models: string[]): [string, ProviderCatalogItem] => [
  id,
  {
    id,
    name,
    auth: { type: "apiKey" as const, envKeys: [`${id.toUpperCase()}_API_KEY`] },
    models: models.map((m) => ({
      id: m,
      name: m,
      provider: id,
      api: "openai-completions",
      reasoning: false,
      input: ["text"] as const,
    })),
  },
];

const MOCK_PROVIDERS: Record<string, ProviderCatalogItem> = Object.fromEntries([
  mockProvider("deepseek", "DeepSeek", ["deepseek-v4-flash", "deepseek-v4-pro"]),
  mockProvider("zai", "z.ai", ["glm-4.5-air", "glm-4.7", "glm-5-turbo", "glm-5.1", "glm-5v-turbo"]),
  mockProvider("openai", "OpenAI", ["gpt-4", "gpt-4.1"]),
]);

function createApi(overrides: Partial<SettingsApi> = {}): SettingsApi {
  return {
    getSupportedProviders: vi.fn().mockResolvedValue(MOCK_PROVIDERS),
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
          deepseek: { apiKey: "deepseek-key" },
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
      deepseek: "deepseek-key",
      zai: "zai-key",
    });
    expect(useSettingsStore.getState().defaultModel).toBe("glm-5.1");
  });

  it("builds settings from dynamic providers and trims api keys", async () => {
    const api = createApi();
    useSettingsStore.setState({
      providers: MOCK_PROVIDERS,
      apiKeys: { deepseek: " key ", openai: "openai-key" },
      defaultModel: "deepseek-v4-flash",
    });

    const ok = await useSettingsStore.getState().save(api);

    expect(ok).toBe(true);
    const saved = (api.saveSettings as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(saved.providers.deepseek.apiKey).toBe("key");
    expect(saved.providers.openai.apiKey).toBe("openai-key");
    expect(saved.providers.zai.apiKey).toBe("");
    expect(saved.defaultModel).toBe("deepseek-v4-flash");
  });

  it("clears default model when disconnecting its provider", async () => {
    const api = createApi();
    useSettingsStore.setState({
      providers: MOCK_PROVIDERS,
      apiKeys: { deepseek: "key", zai: "zai-key" },
      defaultModel: "deepseek-v4-flash",
    });

    await useSettingsStore.getState().disconnect(api, "deepseek");

    expect(useSettingsStore.getState().apiKeys.deepseek).toBe("");
    expect(useSettingsStore.getState().defaultModel).toBe("");
    expect(api.saveSettings).toHaveBeenCalledTimes(1);
  });

  it("does not clear default model when disconnecting a different provider", async () => {
    const api = createApi();
    useSettingsStore.setState({
      providers: MOCK_PROVIDERS,
      apiKeys: { deepseek: "key", zai: "zai-key" },
      defaultModel: "deepseek-v4-flash",
    });

    await useSettingsStore.getState().disconnect(api, "zai");

    expect(useSettingsStore.getState().defaultModel).toBe("deepseek-v4-flash");
  });
});
