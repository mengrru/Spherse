import { create } from "zustand";
import {
  FALLBACK_MODEL_PROVIDERS,
  MODEL_PROVIDER_IDS,
  type AppSettings,
  type ProviderConfig,
  type SettingsApi,
} from "./types";

type SaveMessage = "saved" | "error" | null;

let cachedProviders: Record<string, ProviderConfig> | null = null;
let cachedModelProviders: Record<(typeof MODEL_PROVIDER_IDS)[number], ProviderConfig> | null = null;

interface SettingsStore {
  providers: Record<string, ProviderConfig>;
  apiKeys: Record<string, string>;
  defaultModel: string;
  saving: boolean;
  message: SaveMessage;
  load: (api: SettingsApi) => Promise<void>;
  setApiKey: (id: string, value: string) => void;
  setDefaultModel: (model: string) => void;
  getModelProviders: () => Record<(typeof MODEL_PROVIDER_IDS)[number], ProviderConfig>;
  buildSettings: (keys?: Record<string, string>, model?: string) => AppSettings;
  save: (api: SettingsApi, keys?: Record<string, string>, model?: string) => Promise<boolean>;
  connect: (api: SettingsApi, id: string) => Promise<boolean>;
  disconnect: (api: SettingsApi, id: string) => Promise<boolean>;
}

export const useSettingsStore = create<SettingsStore>((set, get) => ({
  providers: {},
  apiKeys: {},
  defaultModel: "",
  saving: false,
  message: null,

  async load(api) {
    const [providers, settings] = await Promise.all([
      api.getSupportedProviders(),
      api.getSettings(),
    ]);
    const apiKeys: Record<string, string> = {};
    for (const [id, config] of Object.entries(settings?.providers ?? {})) {
      if (config?.apiKey) {
        apiKeys[id] = config.apiKey;
      }
    }
    set({
      providers: providers ?? {},
      apiKeys,
      defaultModel: settings?.defaultModel ?? "",
    });
  },

  setApiKey(id, value) {
    set((state) => ({
      apiKeys: { ...state.apiKeys, [id]: value },
    }));
  },

  setDefaultModel(model) {
    set({ defaultModel: model });
  },

  getModelProviders() {
    const providers = get().providers;
    if (providers === cachedProviders && cachedModelProviders) {
      return cachedModelProviders;
    }
    cachedProviders = providers;
    cachedModelProviders = Object.fromEntries(
      MODEL_PROVIDER_IDS.map((id) => [id, providers[id] ?? FALLBACK_MODEL_PROVIDERS[id]]),
    ) as Record<(typeof MODEL_PROVIDER_IDS)[number], ProviderConfig>;
    return cachedModelProviders;
  },

  buildSettings(keys = get().apiKeys, model = get().defaultModel) {
    const providers: Record<string, { apiKey: string } | undefined> = {};
    for (const id of MODEL_PROVIDER_IDS) {
      providers[id] = { apiKey: (keys[id] ?? "").trim() };
    }
    return {
      providers,
      defaultModel: model,
    };
  },

  async save(api, keys = get().apiKeys, model = get().defaultModel) {
    set({ saving: true, message: null });
    try {
      await api.saveSettings(get().buildSettings(keys, model));
      set({ message: "saved" });
      return true;
    } catch {
      set({ message: "error" });
      return false;
    } finally {
      set({ saving: false });
    }
  },

  async connect(api, id) {
    if (!get().apiKeys[id]?.trim()) return false;
    return get().save(api);
  },

  async disconnect(api, id) {
    const apiKeys = { ...get().apiKeys, [id]: "" };
    const modelProviders = get().getModelProviders();
    const defaultModel = get().defaultModel;
    const nextDefaultModel =
      defaultModel && modelProviders[id as keyof typeof modelProviders]?.models.includes(defaultModel)
        ? ""
        : defaultModel;
    set({ apiKeys, defaultModel: nextDefaultModel });
    return get().save(api, apiKeys, nextDefaultModel);
  },
}));
