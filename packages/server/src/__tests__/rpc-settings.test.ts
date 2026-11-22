import { afterAll, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { applyModelSettingsToEnv } from "../model-settings.js";
import { connectionMethods } from "../rpc/methods/connection.js";
import { settingsMethods } from "../rpc/methods/settings.js";
import {
  createFakeProjectCtx,
  createRpcHarness,
  flush,
  type RpcHarness,
} from "./rpc-test-utils.js";

const alphaRoot = fs.mkdtempSync(path.join(os.tmpdir(), "rpc-settings-alpha-"));

afterAll(() => {
  fs.rmSync(alphaRoot, { recursive: true, force: true });
});

vi.mock("../model-settings.js", () => ({
  applyModelSettingsToEnv: vi.fn(),
}));

const providerCatalog = {
  demo: {
    id: "demo",
    name: "Demo",
    auth: { type: "apiKey" as const, envKeys: ["DEMO_KEY"] },
    models: [
      {
        id: "demo/m1",
        name: "M1",
        provider: "demo",
        api: "demo",
        reasoning: false,
        input: ["text"],
      },
    ],
  },
};

const appliedSettings = {
  text: {
    defaultModel: "demo/m1",
    providers: { demo: { apiKey: "key" } },
    sampling: { temperature: 0.5 },
    thinkingLevel: "low" as const,
  },
  image: { defaultModel: "", providers: {} },
  customProviders: [],
};

const sanitizedSettings = {
  models: {
    text: {
      defaultModel: "demo/m1",
      providers: { demo: { configured: true } },
      sampling: { temperature: 0.5 },
      thinkingLevel: "low" as const,
    },
    image: { defaultModel: "", providers: {} },
  },
  customProviders: [],
};

const projectInfos = [
  { id: "p1", name: "alpha", rootPath: alphaRoot, lastOpened: "2026-01-02T00:00:00.000Z" },
  { id: "p2", name: "beta", rootPath: "/tmp/beta" },
];

const registry = {
  getSupportedProviders: vi.fn(() => providerCatalog),
  listInfo: vi.fn(() => projectInfos),
  getInfo: vi.fn((projectId: string) => projectInfos.find((info) => info.id === projectId)),
  setDefaultModel: vi.fn(),
  setSampling: vi.fn(),
  setThinkingLevel: vi.fn(),
};

const modelSettingsStore = {
  get: vi.fn(() => appliedSettings),
  sanitize: vi.fn(() => sanitizedSettings),
  applyUpdate: vi.fn(() => appliedSettings),
};

const projectManager = {
  getAiAccessSettings: vi.fn(() => ({ deniedPaths: ["/secret"] })),
  updateAiAccessSettings: vi.fn(async () => ({ deniedPaths: ["/next"] })),
  getWelcomePageSettings: vi.fn(() => ({ path: "welcome.md" })),
  updateWelcomePageSettings: vi.fn(async () => ({ path: "next.md" })),
  getSidePanelSettings: vi.fn(() => ({ path: null })),
  updateSidePanelSettings: vi.fn(async () => ({ path: "panel.md" })),
  getRootPath: vi.fn(() => alphaRoot),
  writeFile: vi.fn(async () => {}),
};

function createHarness(): RpcHarness {
  return createRpcHarness({
    methods: { ...settingsMethods, ...connectionMethods },
    projectCtx: createFakeProjectCtx({ projectManager }),
    registry,
    modelSettingsStore,
  });
}

async function call(method: string, params?: unknown): Promise<RpcHarness> {
  const harness = createHarness();
  harness.receive({ type: "call", id: 1, method, params });
  for (let i = 0; i < 10 && harness.sent().length === 0; i++) {
    await flush();
  }
  return harness;
}

describe("rpc connection methods", () => {
  it("connection.info returns authRequired and appVersion", async () => {
    const { sent } = await call("connection.info");
    expect(sent()[0]).toMatchObject({ type: "result", id: 1, ok: true });
    expect(sent()[0].data).toEqual({
      serverVersion: "0.1.0",
      authRequired: false,
      apiVersion: "1",
      appVersion: "test",
    });
  });

  it("connection.projects maps listInfo entries", async () => {
    const { sent } = await call("connection.projects");
    expect(sent()[0]).toMatchObject({ type: "result", id: 1, ok: true });
    expect(sent()[0].data).toEqual([
      { id: "p1", name: "alpha", lastOpened: "2026-01-02T00:00:00.000Z" },
      { id: "p2", name: "beta" },
    ]);
    expect(registry.listInfo).toHaveBeenCalled();
  });

  it("connection.projectInfo returns project details", async () => {
    const { sent } = await call("connection.projectInfo", { projectId: "p1" });
    expect(sent()[0].data).toEqual({
      id: "p1",
      name: "alpha",
      rootPath: alphaRoot,
      lastOpened: "2026-01-02T00:00:00.000Z",
    });
  });

  it("connection.projectInfo maps unknown project to app error 100", async () => {
    const { sent } = await call("connection.projectInfo", { projectId: "nope" });
    expect(sent()[0]).toMatchObject({
      type: "result",
      id: 1,
      ok: false,
      error: { code: 100, message: "Unknown project" },
    });
  });
});

describe("rpc settings methods (global)", () => {
  it("settings.supportedProviders returns the registry provider catalog", async () => {
    const { sent } = await call("settings.supportedProviders");
    expect(registry.getSupportedProviders).toHaveBeenCalled();
    expect(sent()[0]).toMatchObject({ type: "result", id: 1, ok: true });
    expect(sent()[0].data).toEqual(providerCatalog);
  });

  it("settings.imageProviders validates against providerCatalog", async () => {
    const { sent } = await call("settings.imageProviders");
    expect(sent()[0]).toMatchObject({ type: "result", id: 1, ok: true });
    expect(sent()[0].data).toBeTypeOf("object");
  });

  it("settings.getModels returns sanitized settings", async () => {
    const { sent } = await call("settings.getModels");
    expect(modelSettingsStore.sanitize).toHaveBeenCalled();
    expect(sent()[0].data).toEqual(sanitizedSettings);
  });

  it("settings.updateModels applies update, env sync and registry side effects", async () => {
    const request = {
      models: {
        text: {
          defaultModel: "demo/m1",
          sampling: { temperature: 0.5 },
          thinkingLevel: "low" as const,
        },
        image: { defaultModel: "" },
      },
    };
    const { sent, ctx } = await call("settings.updateModels", request);
    expect(modelSettingsStore.applyUpdate).toHaveBeenCalledWith(request);
    expect(vi.mocked(applyModelSettingsToEnv)).toHaveBeenCalledWith(appliedSettings, ctx.modelCatalog);
    expect(registry.setDefaultModel).toHaveBeenCalledWith("demo/m1");
    expect(registry.setSampling).toHaveBeenCalledWith({ temperature: 0.5 });
    expect(registry.setThinkingLevel).toHaveBeenCalledWith("low");
    expect(sent()[0].data).toEqual(sanitizedSettings);
  });
});

describe("rpc settings methods (project)", () => {
  it("settings.getAiAccess returns denied paths", async () => {
    const { sent } = await call("settings.getAiAccess", { projectId: "p1" });
    expect(projectManager.getAiAccessSettings).toHaveBeenCalled();
    expect(sent()[0].data).toEqual({ ok: true, deniedPaths: ["/secret"] });
  });

  it("settings.updateAiAccess forwards denied paths", async () => {
    const { sent } = await call("settings.updateAiAccess", {
      projectId: "p1",
      deniedPaths: ["/next"],
    });
    expect(projectManager.updateAiAccessSettings).toHaveBeenCalledWith(["/next"]);
    expect(sent()[0].data).toEqual({ ok: true, deniedPaths: ["/next"] });
  });

  it("settings.getWelcomePage returns path", async () => {
    const { sent } = await call("settings.getWelcomePage", { projectId: "p1" });
    expect(sent()[0].data).toEqual({ ok: true, path: "welcome.md" });
  });

  it("settings.updateWelcomePage forwards path", async () => {
    const { sent } = await call("settings.updateWelcomePage", { projectId: "p1", path: "next.md" });
    expect(projectManager.updateWelcomePageSettings).toHaveBeenCalledWith("next.md");
    expect(sent()[0].data).toEqual({ ok: true, path: "next.md" });
  });

  it("settings.getSidePanel returns null path", async () => {
    const { sent } = await call("settings.getSidePanel", { projectId: "p1" });
    expect(sent()[0].data).toEqual({ ok: true, path: null });
  });

  it("settings.updateSidePanel forwards path", async () => {
    const { sent } = await call("settings.updateSidePanel", { projectId: "p1", path: "panel.md" });
    expect(projectManager.updateSidePanelSettings).toHaveBeenCalledWith("panel.md");
    expect(sent()[0].data).toEqual({ ok: true, path: "panel.md" });
  });

  it("settings.getTheme returns empty content when theme file is missing", async () => {
    const { sent } = await call("settings.getTheme", { projectId: "p1" });
    expect(projectManager.getRootPath).toHaveBeenCalledWith();
    expect(sent()[0].data).toEqual({ ok: true, content: "" });
  });

  it("settings.updateTheme writes the theme file", async () => {
    const { sent } = await call("settings.updateTheme", { projectId: "p1", content: "body{}" });
    expect(projectManager.writeFile).toHaveBeenCalledWith(".spherse/theme.css", "body{}");
    expect(sent()[0].data).toEqual({ ok: true });
  });

  it("maps unknown project to app error 100", async () => {
    const { sent } = await call("settings.getAiAccess", { projectId: "missing" });
    expect(sent()[0]).toMatchObject({
      type: "result",
      id: 1,
      ok: false,
      error: { code: 100, message: "Unknown project" },
    });
  });
});

describe("rpc settings/connection param validation", () => {
  it("rejects non-string projectId with -32602", async () => {
    const { sent } = await call("settings.getAiAccess", { projectId: 123 });
    expect(sent()[0]).toMatchObject({
      type: "result",
      id: 1,
      ok: false,
      error: { code: -32602 },
    });
  });

  it("rejects missing projectId with -32602", async () => {
    const { sent } = await call("connection.projectInfo", {});
    expect(sent()[0]).toMatchObject({
      type: "result",
      id: 1,
      ok: false,
      error: { code: -32602 },
    });
  });

  it("rejects malformed model settings with -32602", async () => {
    const { sent } = await call("settings.updateModels", { models: {} });
    expect(sent()[0]).toMatchObject({
      type: "result",
      id: 1,
      ok: false,
      error: { code: -32602 },
    });
  });

  it("rejects non-string theme content with -32602", async () => {
    const { sent } = await call("settings.updateTheme", { projectId: "p1", content: 5 });
    expect(sent()[0]).toMatchObject({
      type: "result",
      id: 1,
      ok: false,
      error: { code: -32602 },
    });
  });
});
