import { describe, expect, it, vi, beforeEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const handlers = new Map<string, (...args: unknown[]) => unknown>();
const { relaunch, exit } = vi.hoisted(() => ({ relaunch: vi.fn(), exit: vi.fn() }));

vi.mock("electron", () => ({
  app: { relaunch, exit },
  ipcMain: {
    handle: vi.fn((channel: string, fn: (...args: unknown[]) => unknown) => {
      handlers.set(channel, fn);
    }),
  },
  BrowserWindow: {},
}));

let modelSettingsPath = "";

vi.mock("../settings.js", () => ({
  settingsStore: {
    clear: vi.fn(),
  },
  getModelSettingsPath: () => modelSettingsPath,
}));

import { registerDebugIpc } from "./debug.js";

describe("reset-app-data", () => {
  beforeEach(() => {
    handlers.clear();
    relaunch.mockClear();
    exit.mockClear();
    registerDebugIpc(() => null);
  });

  it("removes model-settings.json alongside clearing the electron store", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "spherse-reset-test-"));
    modelSettingsPath = path.join(dir, "model-settings.json");
    fs.writeFileSync(modelSettingsPath, JSON.stringify({ text: { defaultModel: "m", providers: {} }, image: { defaultModel: "", providers: {} }, customProviders: [] }));

    handlers.get("reset-app-data")!();

    expect(fs.existsSync(modelSettingsPath)).toBe(false);
    expect(relaunch).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(0);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("does not throw when model-settings.json does not exist", () => {
    modelSettingsPath = path.join(os.tmpdir(), `missing-${Date.now()}`, "model-settings.json");

    expect(() => handlers.get("reset-app-data")!()).not.toThrow();
    expect(relaunch).toHaveBeenCalledTimes(1);
  });
});
