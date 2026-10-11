import { describe, expect, it, vi, beforeEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const state = vi.hoisted(() => ({
  userDataDir: "",
  themeSource: "system" as string,
}));

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
  app: {
    isPackaged: true,
    getPath: () => state.userDataDir,
  },
  nativeTheme: {
    set themeSource(value: string) {
      state.themeSource = value;
    },
    get themeSource() {
      return state.themeSource;
    },
  },
}));

import { migrateLegacySettings } from "./migrate-legacy-settings.js";
import { settingsStore, getHostPrefs, getMobileAccess, getServerToken } from "./settings.js";

function modelSettingsPath(): string {
  return path.join(state.userDataDir, "model-settings.json");
}

beforeEach(() => {
  settingsStore.clear();
  state.userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "spherse-migrate-test-"));
  state.themeSource = "system";
});

describe("migrateLegacySettings", () => {
  it("is a no-op without a legacy settings key but still applies theme", () => {
    settingsStore.set("hostPrefs", { locale: "en", theme: "dark", tabsEnabled: true, debugToolsEnabled: false, closeToTray: true });
    migrateLegacySettings();
    expect(settingsStore.get("settings")).toBeUndefined();
    expect(fs.existsSync(modelSettingsPath())).toBe(false);
    expect(state.themeSource).toBe("dark");
  });

  it("splits a legacy settings object into the new keys and deletes it", () => {
    settingsStore.set("serverToken", undefined);
    settingsStore.set("settings", {
      locale: "en",
      theme: "dark",
      tabsEnabled: false,
      debugToolsEnabled: true,
      closeToTray: false,
      models: {
        text: { defaultModel: "deepseek/v4", providers: { deepseek: { apiKey: "sk-live" } }, sampling: { temperature: 0.7 } },
        image: { defaultModel: "", providers: {} },
      },
      customProviders: [
        { id: "my-openai", name: "My OpenAI", baseUrl: "https://api.example.com/v1", models: ["gpt-4o"], keyless: false },
      ],
      mobileAccess: { enabled: true, token: "legacy-tok", mode: "manual", publicDomain: "https://x.com" },
    });

    migrateLegacySettings();

    expect(settingsStore.get("settings")).toBeUndefined();
    expect(getServerToken()).toBe("legacy-tok");
    expect(getHostPrefs()).toEqual({
      locale: "en",
      theme: "dark",
      tabsEnabled: false,
      debugToolsEnabled: true,
      closeToTray: false,
    });
    expect(getMobileAccess()).toEqual({
      enabled: true,
      token: undefined,
      mode: "manual",
      publicDomain: "https://x.com",
    });
    expect(state.themeSource).toBe("dark");

    const persisted = JSON.parse(fs.readFileSync(modelSettingsPath(), "utf-8"));
    expect(persisted.text.defaultModel).toBe("deepseek/v4");
    expect(persisted.text.providers.deepseek.apiKey).toBe("sk-live");
    expect(persisted.text.sampling).toEqual({ temperature: 0.7 });
    expect(persisted.customProviders).toHaveLength(1);
  });

  it("keeps an existing serverToken over the legacy mobileAccess token", () => {
    settingsStore.set("serverToken", "current-tok");
    settingsStore.set("settings", { locale: "zh-CN", mobileAccess: { enabled: true, token: "legacy-tok" } });
    migrateLegacySettings();
    expect(getServerToken()).toBe("current-tok");
  });

  it("does not overwrite an existing model-settings.json", () => {
    fs.mkdirSync(state.userDataDir, { recursive: true });
    fs.writeFileSync(modelSettingsPath(), JSON.stringify({ text: { defaultModel: "existing/m", providers: {} }, image: { defaultModel: "", providers: {} }, customProviders: [] }));
    settingsStore.set("settings", {
      locale: "zh-CN",
      models: { text: { defaultModel: "legacy/m", providers: {} }, image: { defaultModel: "", providers: {} } },
    });
    migrateLegacySettings();
    const persisted = JSON.parse(fs.readFileSync(modelSettingsPath(), "utf-8"));
    expect(persisted.text.defaultModel).toBe("existing/m");
  });

  it("does not overwrite existing hostPrefs and top-level mobileAccess", () => {
    settingsStore.set("hostPrefs", { locale: "ja", theme: "light", tabsEnabled: true, debugToolsEnabled: false, closeToTray: true });
    settingsStore.set("mobileAccess", { enabled: false, token: "current", mode: "quick" });
    settingsStore.set("settings", {
      locale: "en",
      mobileAccess: { enabled: true, token: "legacy", mode: "manual" },
      models: { text: { defaultModel: "", providers: {} }, image: { defaultModel: "", providers: {} } },
    });
    migrateLegacySettings();
    expect(getHostPrefs().locale).toBe("ja");
    expect(getMobileAccess()).toEqual({ enabled: false, token: "current", mode: "quick", publicDomain: undefined });
  });

  it("is idempotent on a second run", () => {
    settingsStore.set("settings", {
      locale: "en",
      models: { text: { defaultModel: "m", providers: {} }, image: { defaultModel: "", providers: {} } },
    });
    migrateLegacySettings();
    const first = fs.readFileSync(modelSettingsPath(), "utf-8");
    expect(() => migrateLegacySettings()).not.toThrow();
    expect(fs.readFileSync(modelSettingsPath(), "utf-8")).toBe(first);
  });
});
