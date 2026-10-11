import { beforeEach, describe, expect, it, vi } from "vitest";
import type { HostBridge } from "../lib/host-bridge";
import { useSettingsStore } from "./settings-store";

function createBridge(overrides: {
  general?: { locale: string; tabsEnabled?: boolean };
  desktop?: { theme: "light" | "dark" | "system"; debugToolsEnabled: boolean; closeToTray: boolean } | null;
} = {}): HostBridge {
  const defaultDesktop = { theme: "system" as const, debugToolsEnabled: false, closeToTray: true };
  return {
    kind: "electron",
    capabilities: { filePicker: true, mobileAccess: false, openFileExternal: true, content: { editable: true } },
    getServerBaseUrl: vi.fn(async () => "http://localhost:5173"),
    getAppVersion: vi.fn(async () => "0.0.0-test"),
    prefs: {
      getPrefs: vi.fn(async () => ({ locale: overrides.general?.locale ?? "zh-CN", tabsEnabled: overrides.general?.tabsEnabled ?? true })),
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
    expect(bridge.prefs.savePrefs).toHaveBeenCalledWith({ locale: "en", tabsEnabled: true });
  });

  it("loads desktop prefs when the channel exists", async () => {
    await useSettingsStore.getState().loadPrefs(createBridge({
      desktop: { theme: "dark", debugToolsEnabled: true, closeToTray: false },
    }));

    expect(useSettingsStore.getState().theme).toBe("dark");
    expect(useSettingsStore.getState().debugToolsEnabled).toBe(true);
    expect(useSettingsStore.getState().closeToTray).toBe(false);
    expect(useSettingsStore.getState().loaded).toBe(true);
  });

  it("loads tabsEnabled from general prefs", async () => {
    await useSettingsStore.getState().loadPrefs(createBridge({ general: { locale: "zh-CN", tabsEnabled: false } }));
    expect(useSettingsStore.getState().tabsEnabled).toBe(false);

    await useSettingsStore.getState().loadPrefs(createBridge({ general: { locale: "zh-CN" } }));
    expect(useSettingsStore.getState().tabsEnabled).toBe(true);
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
      debugToolsEnabled: false,
      closeToTray: true,
    });
  });

  it("setDebugToolsEnabled preserves other desktop fields", async () => {
    const bridge = createBridge();
    useSettingsStore.setState({ theme: "dark" });

    await useSettingsStore.getState().setDebugToolsEnabled(bridge, true);

    expect(bridge.desktopPrefs?.savePrefs).toHaveBeenCalledWith({
      theme: "dark",
      debugToolsEnabled: true,
      closeToTray: true,
    });
  });

  it("setTabsEnabled persists via the general prefs channel", async () => {
    const bridge = createBridge();
    useSettingsStore.setState({ locale: "en", tabsEnabled: true });

    const ok = await useSettingsStore.getState().setTabsEnabled(bridge, false);

    expect(ok).toBe(true);
    expect(useSettingsStore.getState().tabsEnabled).toBe(false);
    expect(bridge.prefs.savePrefs).toHaveBeenCalledWith({ locale: "en", tabsEnabled: false });
  });

  it("setCloseToTray preserves other desktop fields", async () => {
    const bridge = createBridge();

    await useSettingsStore.getState().setCloseToTray(bridge, false);

    expect(bridge.desktopPrefs?.savePrefs).toHaveBeenCalledWith(expect.objectContaining({ closeToTray: false, theme: "system" }));
  });

  it("desktop setters are no-ops without the desktopPrefs channel", async () => {
    const bridge = createBridge({ desktop: null });

    const ok = await useSettingsStore.getState().setTheme(bridge, "dark");

    expect(ok).toBe(false);
    expect(useSettingsStore.getState().theme).toBe("dark");
  });
});
