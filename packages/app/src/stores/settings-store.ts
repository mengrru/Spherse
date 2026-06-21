import { create } from "zustand";
import type { SettingsApi } from "../features/settings/types";

interface SettingsStore {
  locale: string;
  loadLocale: (api: SettingsApi) => Promise<void>;
  changeLocale: (api: SettingsApi, locale: string) => Promise<boolean>;
}

export const useSettingsStore = create<SettingsStore>((set) => ({
  locale: "zh-CN",

  async loadLocale(api) {
    const settings = await api.getSettings();
    set({ locale: settings?.locale ?? "zh-CN" });
  },

  async changeLocale(api, locale) {
    set({ locale });
    const settings = await api.getSettings();
    await api.saveSettings({
      locale,
      models: settings?.models,
    });
    return true;
  },
}));
