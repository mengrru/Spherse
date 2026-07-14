import { create } from "zustand";
import type { ThemeMode } from "@shared/electron-api";
import type { SettingsApi } from "../features/settings/types";

interface SettingsStore {
  locale: string;
  debugToolsEnabled: boolean;
  theme: ThemeMode;
  loadLocale: (api: SettingsApi) => Promise<void>;
  changeLocale: (api: SettingsApi, locale: string) => Promise<boolean>;
  setDebugToolsEnabled: (api: SettingsApi, enabled: boolean) => Promise<boolean>;
  setTheme: (api: SettingsApi, theme: ThemeMode) => Promise<boolean>;
}

export const useSettingsStore = create<SettingsStore>((set, get) => ({
  locale: "zh-CN",
  debugToolsEnabled: false,
  theme: "system",

  async loadLocale(api) {
    const settings = await api.getSettings();
    set({
      locale: settings?.locale ?? "zh-CN",
      debugToolsEnabled: settings?.debugToolsEnabled ?? false,
      theme: settings?.theme ?? "system",
    });
  },

  async changeLocale(api, locale) {
    set({ locale });
    const settings = await api.getSettings();
    await api.saveSettings({
      locale,
      models: settings?.models,
      debugToolsEnabled: get().debugToolsEnabled,
      theme: get().theme,
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
      theme: get().theme,
    });
    return true;
  },

  async setTheme(api, theme) {
    set({ theme });
    const settings = await api.getSettings();
    await api.saveSettings({
      locale: settings?.locale ?? get().locale,
      models: settings?.models,
      debugToolsEnabled: get().debugToolsEnabled,
      theme,
    });
    return true;
  },
}));
