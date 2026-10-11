import { describe, expect, it, vi, beforeEach } from "vitest";

const handlers = new Map<string, (...args: unknown[]) => unknown>();

vi.mock("electron", () => ({
  ipcMain: {
    handle: vi.fn((channel: string, fn: (...args: unknown[]) => unknown) => {
      handlers.set(channel, fn);
    }),
  },
  BrowserWindow: {},
}));

const { prefsStore, syncTray } = vi.hoisted(() => {
  const syncTray = vi.fn();
  return {
    prefsStore: {
      general: { locale: "zh-CN", tabsEnabled: true },
      desktop: { theme: "system" as string, debugToolsEnabled: false, closeToTray: true },
    },
    syncTray,
  };
});

vi.mock("../settings.js", () => ({
  getGeneralPrefs: () => ({ ...prefsStore.general }),
  saveGeneralPrefs: (prefs: { locale: string; tabsEnabled: boolean }) => {
    prefsStore.general = { ...prefs };
  },
  getDesktopPrefs: () => ({ ...prefsStore.desktop }),
  saveDesktopPrefs: (prefs: typeof prefsStore.desktop) => {
    prefsStore.desktop = { ...prefs };
  },
}));

vi.mock("../tray.js", () => ({
  syncTray,
}));

import { registerHostPrefsIpc } from "./host-prefs.js";

beforeEach(() => {
  handlers.clear();
  syncTray.mockClear();
  registerHostPrefsIpc();
});

describe("host prefs ipc", () => {
  it("registers four channels", () => {
    expect([...handlers.keys()].sort()).toEqual([
      "get-desktop-prefs",
      "get-general-prefs",
      "save-desktop-prefs",
      "save-general-prefs",
    ]);
  });

  it("get-general-prefs returns current prefs", () => {
    expect(handlers.get("get-general-prefs")!()).toEqual({ locale: "zh-CN", tabsEnabled: true });
  });

  it("save-general-prefs persists and syncs tray", () => {
    const result = handlers.get("save-general-prefs")!(undefined, { locale: "en", tabsEnabled: false });
    expect(result).toEqual({ success: true });
    expect(prefsStore.general).toEqual({ locale: "en", tabsEnabled: false });
    expect(syncTray).toHaveBeenCalledTimes(1);
  });

  it("save-desktop-prefs persists and syncs tray", () => {
    const result = handlers.get("save-desktop-prefs")!(undefined, {
      theme: "dark",
      debugToolsEnabled: true,
      closeToTray: false,
    });
    expect(result).toEqual({ success: true });
    expect(prefsStore.desktop).toEqual({
      theme: "dark",
      debugToolsEnabled: true,
      closeToTray: false,
    });
    expect(syncTray).toHaveBeenCalledTimes(1);
  });
});
