import { create } from "zustand";
import { normalizeLocale, type Locale } from "@spherse/i18n";
import type { HostBridge, ThemeMode } from "../lib/host-bridge";

const DEFAULT_DESKTOP_PREFS = {
  theme: "system" as ThemeMode,
  debugToolsEnabled: false,
  closeToTray: true,
};

interface SettingsStore {
  loaded: boolean;
  locale: Locale;
  debugToolsEnabled: boolean;
  tabsEnabled: boolean;
  closeToTray: boolean;
  theme: ThemeMode;
  loadPrefs: (bridge: HostBridge) => Promise<void>;
  changeLocale: (bridge: HostBridge, locale: Locale) => Promise<boolean>;
  setDebugToolsEnabled: (bridge: HostBridge, enabled: boolean) => Promise<boolean>;
  setTabsEnabled: (bridge: HostBridge, enabled: boolean) => Promise<boolean>;
  setCloseToTray: (bridge: HostBridge, enabled: boolean) => Promise<boolean>;
  setTheme: (bridge: HostBridge, theme: ThemeMode) => Promise<boolean>;
}

type DesktopOnlyPrefs = Pick<SettingsStore, "debugToolsEnabled" | "closeToTray" | "theme">;

export const useSettingsStore = create<SettingsStore>((set, get) => {
  async function persistDesktopPrefs(bridge: HostBridge, patch: Partial<DesktopOnlyPrefs>): Promise<boolean> {
    const prefs = bridge.desktopPrefs;
    if (!prefs) return false;
    return prefs.savePrefs({
      theme: patch.theme ?? get().theme,
      debugToolsEnabled: patch.debugToolsEnabled ?? get().debugToolsEnabled,
      closeToTray: patch.closeToTray ?? get().closeToTray,
    });
  }

  return {
    loaded: false,
    locale: "zh-CN",
    debugToolsEnabled: false,
    tabsEnabled: true,
    closeToTray: true,
    theme: "system",

    async loadPrefs(bridge) {
      const [general, desktop] = await Promise.all([
        bridge.prefs.getPrefs().catch(() => null),
        bridge.desktopPrefs?.getPrefs().catch(() => null) ?? Promise.resolve(null),
      ]);
      set({
        loaded: true,
        locale: normalizeLocale(general?.locale),
        tabsEnabled: general?.tabsEnabled ?? true,
        ...DEFAULT_DESKTOP_PREFS,
        ...(desktop ?? {}),
      });
    },

    async changeLocale(bridge, locale) {
      set({ locale });
      const current = get();
      return bridge.prefs.savePrefs({ locale, tabsEnabled: current.tabsEnabled });
    },

    async setDebugToolsEnabled(bridge, enabled) {
      set({ debugToolsEnabled: enabled });
      return persistDesktopPrefs(bridge, { debugToolsEnabled: enabled });
    },

    async setTabsEnabled(bridge, enabled) {
      set({ tabsEnabled: enabled });
      const current = get();
      return bridge.prefs.savePrefs({ locale: current.locale, tabsEnabled: enabled });
    },

    async setCloseToTray(bridge, enabled) {
      set({ closeToTray: enabled });
      return persistDesktopPrefs(bridge, { closeToTray: enabled });
    },

    async setTheme(bridge, theme) {
      set({ theme });
      return persistDesktopPrefs(bridge, { theme });
    },
  };
});
