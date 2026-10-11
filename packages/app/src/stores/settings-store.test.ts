import { beforeEach, describe, expect, it, vi } from "vitest";
import type { HostBridge } from "../lib/host-bridge";
import { useSettingsStore } from "./settings-store";

function createBridge(overrides: {
  general?: { locale: string };
  desktop?: { theme: "light" | "dark" | "system"; tabsEnabled: boolean; debugToolsEnabled: boolean; closeToTray: boolean } | null;
} = {}): HostBridge {
  const defaultDesktop = { theme: "system" as const, tabsEnabled: true, debugToolsEnabled: false, closeToTray: true };
  return {
    kind: "electron",
    capabilities: { filePicker: true, mobileAccess: false, openFileExternal: true, content: { editable: true } },
    getServerBaseUrl: vi.fn(async () => "http://localhost:5173"),
    prefs: {
      getPrefs: vi.fn(async () => overrides.general ?? { locale: "zh-CN" }),
      savePrefs: vi.fn(async () => true),
    },
    desktopPrefs: overrides.desktop === null ? undefined : {
      getPrefs: vi.fn(async () => overrides.desktop ?? defaultDesktop),
      savePrefs: vi.fn(async () => true),
    },
    openExternal: vi.fn(async () => {}),
  };
}

describe("useSettingsStore", () => {
  beforeEach(() => {
    useSettingsStore.setState({ loaded: false, locale: "zh-CN", debugToolsEnabled: false, tabsEnabled: true, closeToTray: true, theme: "system" });
  });

  it("loads locale from general prefs", async () => {
    await useSettingsStore.getState().loadPrefs(createBridge({ general: { locale: "en" } }));
    expect(useSettingsStore.getState().locale).toBe("en");
  });

  it("defaults to zh-CN when no locale in prefs", async () => {
    await useSettingsStore.getState().loadPrefs(createBridge());
    expect(useSettingsStore.getState().locale).toBe("zh-CN");
  });

  it("changeLocale updates locale and persists via prefs channel", async () => {
    const bridge = createBridge({ general: { locale: "zh-CN" } });

    const ok = await useSettingsStore.getState().changeLocale(bridge, "en");

    expect(ok).toBe(true);
    expect(useSettingsStore.getState().locale).toBe("en");
    expect(bridge.prefs.savePrefs).toHaveBeenCalledWith({ locale: "en" });
  });

  it("loads desktop prefs when the channel exists", async () => {
    await useSettingsStore.getState().loadPrefs(createBridge({
      desktop: { theme: "dark", tabsEnabled: false, debugToolsEnabled: true, closeToTray: false },
    }));

    expect(useSettingsStore.getState().theme).toBe("dark");
    expect(useSettingsStore.getState().tabsEnabled).toBe(false);
    expect(useSettingsStore.getState().debugToolsEnabled).toBe(true);
    expect(useSettingsStore.getState().closeToTray).toBe(false);
    expect(useSettingsStore.getState().loaded).toBe(true);
  });

  it("falls back to desktop defaults when the channel is absent (web)", async () => {
    await useSettingsStore.getState().loadPrefs(createBridge({ desktop: null }));

    expect(useSettingsStore.getState().theme).toBe("system");
    expect(useSettingsStore.getState().tabsEnabled).toBe(true);
    expect(useSettingsStore.getState().debugToolsEnabled).toBe(false);
    expect(useSettingsStore.getState().closeToTray).toBe(true);
    expect(useSettingsStore.getState().loaded).toBe(true);
  });

  it("setTheme persists the full desktop prefs object", async () => {
    const bridge = createBridge();

    const ok = await useSettingsStore.getState().setTheme(bridge, "dark");

    expect(ok).toBe(true);
    expect(useSettingsStore.getState().theme).toBe("dark");
    expect(bridge.desktopPrefs?.savePrefs).toHaveBeenCalledWith({
      theme: "dark",
      tabsEnabled: true,
      debugToolsEnabled: false,
      closeToTray: true,
    });
  });

  it("setDebugToolsEnabled preserves other desktop fields", async () => {
    const bridge = createBridge();
    useSettingsStore.setState({ theme: "dark", tabsEnabled: false });

    await useSettingsStore.getState().setDebugToolsEnabled(bridge, true);

    expect(bridge.desktopPrefs?.savePrefs).toHaveBeenCalledWith({
      theme: "dark",
      tabsEnabled: false,
      debugToolsEnabled: true,
      closeToTray: true,
    });
  });

  it("setTabsEnabled preserves other desktop fields", async () => {
    const bridge = createBridge();
    useSettingsStore.setState({ closeToTray: false, theme: "light" });

    await useSettingsStore.getState().setTabsEnabled(bridge, false);

    expect(bridge.desktopPrefs?.savePrefs).toHaveBeenCalledWith({
      theme: "light",
      tabsEnabled: false,
      debugToolsEnabled: false,
      closeToTray: false,
    });
  });

  it("setCloseToTray preserves other desktop fields", async () => {
    const bridge = createBridge();

    await useSettingsStore.getState().setCloseToTray(bridge, false);

    expect(bridge.desktopPrefs?.savePrefs).toHaveBeenCalledWith(expect.objectContaining({ closeToTray: false, tabsEnabled: true }));
  });

  it("desktop setters are no-ops without the desktopPrefs channel", async () => {
    const bridge = createBridge({ desktop: null });

    const ok = await useSettingsStore.getState().setTheme(bridge, "dark");

    expect(ok).toBe(false);
    expect(useSettingsStore.getState().theme).toBe("dark");
  });
});
