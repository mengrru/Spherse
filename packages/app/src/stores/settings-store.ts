import { create } from "zustand";
import type { SettingsApi } from "../features/settings/types";

interface SettingsStore {
  locale: string;
  debugToolsEnabled: boolean;
  loadLocale: (api: SettingsApi) => Promise<void>;
  changeLocale: (api: SettingsApi, locale: string) => Promise<boolean>;
  setDebugToolsEnabled: (api: SettingsApi, enabled: boolean) => Promise<boolean>;
}

export const useSettingsStore = create<SettingsStore>((set, get) => ({
  locale: "zh-CN",
  debugToolsEnabled: false,

  async loadLocale(api) {
    const settings = await api.getSettings();
    set({
      locale: settings?.locale ?? "zh-CN",
      debugToolsEnabled: settings?.debugToolsEnabled ?? false,
    });
  },

  async changeLocale(api, locale) {
    set({ locale });
    const settings = await api.getSettings();
    await api.saveSettings({
      locale,
      models: settings?.models,
      debugToolsEnabled: get().debugToolsEnabled,
    });
    return true;
  },

  async setDebugToolsEnabled(api, enabled) {
    set({ debugToolsEnabled: enabled });
    const settings = await api.getSettings();
    await api.saveSettings({
      locale: settings?.locale ?? get().locale,
      models: settings?.models,
      debugToolsEnabled: enabled,
    });
    return true;
  },
}));
