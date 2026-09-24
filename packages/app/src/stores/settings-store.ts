import { create } from "zustand";
import { normalizeLocale, type Locale } from "@spherse/i18n";
import type { HostBridge, HostSettings, ThemeMode } from "../lib/host-bridge";

export type SettingsStoreApi = Pick<HostBridge, "getSettings" | "saveSettings">;

interface SettingsStore {
  loaded: boolean;
  locale: Locale;
  debugToolsEnabled: boolean;
  tabsEnabled: boolean;
  closeToTray: boolean;
  theme: ThemeMode;
  loadLocale: (api: SettingsStoreApi) => Promise<void>;
  changeLocale: (api: SettingsStoreApi, locale: Locale) => Promise<boolean>;
  setDebugToolsEnabled: (api: SettingsStoreApi, enabled: boolean) => Promise<boolean>;
  setTabsEnabled: (api: SettingsStoreApi, enabled: boolean) => Promise<boolean>;
  setCloseToTray: (api: SettingsStoreApi, enabled: boolean) => Promise<boolean>;
  setTheme: (api: SettingsStoreApi, theme: ThemeMode) => Promise<boolean>;
}

type UiSettings = Pick<SettingsStore, "debugToolsEnabled" | "tabsEnabled" | "closeToTray" | "theme">;

export const useSettingsStore = create<SettingsStore>((set, get) => {
  async function persist(api: SettingsStoreApi, patch: Partial<UiSettings> & { locale?: Locale }) {
    const settings = await api.getSettings();
    const next: HostSettings = {
      locale: patch.locale ?? settings?.locale ?? get().locale,
      models: settings?.models,
      debugToolsEnabled: get().debugToolsEnabled,
      tabsEnabled: get().tabsEnabled,
      closeToTray: get().closeToTray,
      theme: get().theme,
      ...patch,
    };
    await api.saveSettings(next);
    return true;
  }

  return {
    loaded: false,
    locale: "zh-CN",
    debugToolsEnabled: false,
    tabsEnabled: true,
    closeToTray: true,
    theme: "system",

    async loadLocale(api) {
      const settings = await api.getSettings().catch((err: unknown) => {
        set({ loaded: true });
        throw err;
      });
      set({
        loaded: true,
        locale: normalizeLocale(settings?.locale),
        debugToolsEnabled: settings?.debugToolsEnabled ?? false,
        tabsEnabled: settings?.tabsEnabled ?? true,
        closeToTray: settings?.closeToTray ?? true,
        theme: settings?.theme ?? "system",
      });
    },

    async changeLocale(api, locale) {
      set({ locale });
      return persist(api, { locale });
    },

    async setDebugToolsEnabled(api, enabled) {
      set({ debugToolsEnabled: enabled });
      return persist(api, { debugToolsEnabled: enabled });
    },

    async setTabsEnabled(api, enabled) {
      set({ tabsEnabled: enabled });
      return persist(api, { tabsEnabled: enabled });
    },

    async setCloseToTray(api, enabled) {
      set({ closeToTray: enabled });
      return persist(api, { closeToTray: enabled });
    },

    async setTheme(api, theme) {
      set({ theme });
      return persist(api, { theme });
    },
  };
});
