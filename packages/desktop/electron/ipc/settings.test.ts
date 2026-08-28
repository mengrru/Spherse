import { describe, expect, it, vi, beforeEach } from "vitest";

const handlers = new Map<string, (...args: unknown[]) => unknown>();

vi.mock("electron", () => ({
  ipcMain: {
    handle: (channel: string, handler: (...args: unknown[]) => unknown) => {
      handlers.set(channel, handler);
    },
  },
}));

const { saveSettingsMock, updateDefaultModelMock, updateSamplingMock, updateThinkingLevelMock } =
  vi.hoisted(() => ({
    saveSettingsMock: vi.fn(),
    updateDefaultModelMock: vi.fn(),
    updateSamplingMock: vi.fn(),
    updateThinkingLevelMock: vi.fn(),
  }));

vi.mock("../settings.js", () => ({
  saveSettings: saveSettingsMock,
  getMaskedSettings: vi.fn(),
}));
vi.mock("../server.js", () => ({
  updateDefaultModel: updateDefaultModelMock,
  updateSampling: updateSamplingMock,
  updateThinkingLevel: updateThinkingLevelMock,
}));
vi.mock("../model-catalog.js", () => ({
  getAppModelCatalog: vi.fn(() => ({ getSupportedProviders: () => ({}) })),
}));
vi.mock("@spherse/core", () => ({
  getImageSupportedProviders: vi.fn(() => ({})),
}));

import { registerSettingsIpc } from "./settings.js";

function saveSettingsHandler(): (settings: unknown) => unknown {
  const handler = handlers.get("save-settings");
  if (!handler) throw new Error("save-settings handler not registered");
  return (settings: unknown) => handler(null, settings);
}

describe("save-settings ipc propagation", () => {
  beforeEach(() => {
    handlers.clear();
    vi.clearAllMocks();
    registerSettingsIpc();
  });

  it("propagates stored thinkingLevel to updateThinkingLevel", () => {
    saveSettingsHandler()({
      locale: "zh-CN",
      models: {
        text: { defaultModel: "p/m", providers: {}, thinkingLevel: "high" },
        image: { defaultModel: "", providers: {} },
      },
    });

    expect(saveSettingsMock).toHaveBeenCalledTimes(1);
    expect(updateThinkingLevelMock).toHaveBeenCalledWith("high");
  });

  it("propagates undefined thinkingLevel unconditionally (reset to medium)", () => {
    saveSettingsHandler()({
      locale: "zh-CN",
      models: {
        text: { defaultModel: "p/m", providers: {} },
        image: { defaultModel: "", providers: {} },
      },
    });

    expect(updateThinkingLevelMock).toHaveBeenCalledWith(undefined);
  });

  it("still propagates defaultModel and sampling alongside thinkingLevel", () => {
    saveSettingsHandler()({
      locale: "zh-CN",
      models: {
        text: {
          defaultModel: "p/m",
          providers: {},
          sampling: { temperature: 0.5 },
          thinkingLevel: "low",
        },
        image: { defaultModel: "", providers: {} },
      },
    });

    expect(updateDefaultModelMock).toHaveBeenCalledWith("p/m");
    expect(updateSamplingMock).toHaveBeenCalledWith({ temperature: 0.5 });
    expect(updateThinkingLevelMock).toHaveBeenCalledWith("low");
  });
});
