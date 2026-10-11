import { describe, expect, it, vi } from "vitest";

vi.mock("electron-store", () => ({
  default: class MockStore {
    private data: Record<string, unknown> = {};
    get(key: string) {
      return this.data[key];
    }
    set(key: string, value: unknown) {
      this.data[key] = value;
    }
    delete(key: string) {
      delete this.data[key];
    }
    clear() {
      this.data = {};
    }
  },
}));

vi.mock("electron", () => ({
  app: { isPackaged: false, getPath: () => "/tmp/spherse-test-userdata" },
  nativeTheme: { themeSource: "system" },
}));

import { nativeTheme } from "electron";
import {
  settingsStore,
  getHostPrefs,
  getGeneralPrefs,
  saveGeneralPrefs,
  getDesktopPrefs,
  saveDesktopPrefs,
  getCloseToTray,
  getLocale,
  getMobileAccess,
  setMobileAccess,
  getServerToken,
  setServerToken,
  generateAccessToken,
  getModelSettingsPath,
} from "./settings.js";

describe("hostPrefs", () => {
  it("returns defaults on fresh install", () => {
    settingsStore.set("hostPrefs", undefined);
    expect(getHostPrefs()).toEqual({
      locale: "zh-CN",
      theme: "system",
      tabsEnabled: true,
      debugToolsEnabled: false,
      closeToTray: true,
    });
    expect(getGeneralPrefs()).toEqual({ locale: "zh-CN" });
    expect(getDesktopPrefs()).toEqual({
      theme: "system",
      tabsEnabled: true,
      debugToolsEnabled: false,
      closeToTray: true,
    });
  });

  it("merges stored hostPrefs over defaults", () => {
    settingsStore.set("hostPrefs", { locale: "en", theme: "dark", tabsEnabled: false, debugToolsEnabled: true, closeToTray: false });
    expect(getHostPrefs()).toEqual({
      locale: "en",
      theme: "dark",
      tabsEnabled: false,
      debugToolsEnabled: true,
      closeToTray: false,
    });
    expect(getCloseToTray()).toBe(false);
    expect(getLocale()).toBe("en");
  });

  it("saveGeneralPrefs only touches locale", () => {
    settingsStore.set("hostPrefs", { locale: "zh-CN", theme: "dark", tabsEnabled: false, debugToolsEnabled: true, closeToTray: false });
    saveGeneralPrefs({ locale: "en" });
    expect(settingsStore.get("hostPrefs")).toEqual({
      locale: "en",
      theme: "dark",
      tabsEnabled: false,
      debugToolsEnabled: true,
      closeToTray: false,
    });
  });

  it("saveDesktopPrefs persists fields and applies theme source", () => {
    saveDesktopPrefs({ theme: "dark", tabsEnabled: false, debugToolsEnabled: true, closeToTray: true });
    expect(settingsStore.get("hostPrefs")).toMatchObject({ theme: "dark", tabsEnabled: false });
    expect(nativeTheme.themeSource).toBe("dark");
  });

  it("defaults closeToTray to false in an unpackaged dev run", () => {
    vi.stubEnv("NODE_ENV", "development");
    try {
      settingsStore.set("hostPrefs", undefined);
      expect(getCloseToTray()).toBe(false);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe("mobileAccess top-level key", () => {
  it("defaults mode to quick and other fields to empty", () => {
    settingsStore.set("mobileAccess", undefined);
    expect(getMobileAccess()).toEqual({ enabled: false, token: undefined, mode: "quick", publicDomain: undefined });
  });

  it("setMobileAccess merges patch preserving untouched fields", () => {
    settingsStore.set("mobileAccess", undefined);
    setMobileAccess({ enabled: true, token: "abc", mode: "manual", publicDomain: "https://a.com" });
    setMobileAccess({ publicDomain: "https://b.com" });
    expect(getMobileAccess()).toEqual({
      enabled: true,
      token: "abc",
      mode: "manual",
      publicDomain: "https://b.com",
    });
  });
});

describe("serverToken", () => {
  it("generates and persists when nothing exists", () => {
    settingsStore.set("serverToken", undefined);
    settingsStore.set("mobileAccess", undefined);
    const token = getServerToken();
    expect(token).toBeTruthy();
    expect(settingsStore.get("serverToken")).toBe(token);
  });

  it("falls back to top-level mobileAccess.token", () => {
    settingsStore.set("serverToken", undefined);
    settingsStore.set("mobileAccess", { enabled: true, token: "legacy-tok" });
    expect(getServerToken()).toBe("legacy-tok");
    expect(settingsStore.get("serverToken")).toBe("legacy-tok");
  });

  it("prefers existing serverToken over mobileAccess token", () => {
    settingsStore.set("mobileAccess", { enabled: true, token: "legacy-tok" });
    settingsStore.set("serverToken", "current-tok");
    expect(getServerToken()).toBe("current-tok");
  });

  it("setServerToken overwrites and getServerToken returns it", () => {
    settingsStore.set("serverToken", "a");
    setServerToken("b");
    expect(getServerToken()).toBe("b");
  });

  it("generateAccessToken produces distinct secrets", () => {
    expect(generateAccessToken()).not.toBe(generateAccessToken());
  });
});

describe("getModelSettingsPath", () => {
  it("lives under userData", () => {
    expect(getModelSettingsPath()).toBe("/tmp/spherse-test-userdata/model-settings.json");
  });
});
