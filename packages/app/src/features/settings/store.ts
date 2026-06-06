import { create } from "zustand";
import {
  type AppSettings,
  type ProviderConfig,
  type SettingsApi,
} from "./types";

type SaveMessage = "saved" | "error" | null;

interface SettingsStore {
  providers: Record<string, ProviderConfig>;
  apiKeys: Record<string, string>;
  defaultModel: string;
  locale: string;
  saving: boolean;
  message: SaveMessage;
  load: (api: SettingsApi) => Promise<void>;
  setApiKey: (id: string, value: string) => void;
  setDefaultModel: (model: string) => void;
  setLocale: (locale: string) => void;
  buildSettings: (keys?: Record<string, string>, model?: string) => AppSettings;
  save: (api: SettingsApi, keys?: Record<string, string>, model?: string) => Promise<boolean>;
  connect: (api: SettingsApi, id: string) => Promise<boolean>;
  disconnect: (api: SettingsApi, id: string) => Promise<boolean>;
}

export const useSettingsStore = create<SettingsStore>((set, get) => ({
  providers: {},
  apiKeys: {},
  defaultModel: "",
  locale: "zh-CN",
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
      locale: settings?.locale ?? "zh-CN",
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

  setLocale(locale) {
    set({ locale });
  },

  buildSettings(keys = get().apiKeys, model = get().defaultModel) {
    const providers: Record<string, { apiKey: string } | undefined> = {};
    for (const id of Object.keys(get().providers)) {
      providers[id] = { apiKey: (keys[id] ?? "").trim() };
    }
    return {
      providers,
      defaultModel: model,
      locale: get().locale,
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
    const providers = get().providers;
    const defaultModel = get().defaultModel;
    const nextDefaultModel =
      defaultModel && providers[id]?.models.some((m) => defaultModel === `${id}/${m.id}`)
        ? ""
        : defaultModel;
    set({ apiKeys, defaultModel: nextDefaultModel });
    return get().save(api, apiKeys, nextDefaultModel);
  },
}));
