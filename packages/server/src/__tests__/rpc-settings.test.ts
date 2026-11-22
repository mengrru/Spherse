import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ModelCatalog } from "@spherse/core";
import type { ModelSettingsResponse } from "@spherse/contracts";
import { connectionMethods } from "@spherse/rpc/methods";
import { settingsMethods } from "../rpc/methods/settings.js";
import { ModelSettingsStore } from "../model-settings.js";
import type { ProjectRegistry } from "../registry.js";
import { createRpcModelSettings } from "../rpc/model-settings-port.js";
import {
  callMethod,
  createFakeProjectCtx,
  createRpcHarness,
  flush,
  type RpcHarness,
} from "@spherse/rpc/testing";

const alphaRoot = fs.mkdtempSync(path.join(os.tmpdir(), "rpc-settings-alpha-"));

afterAll(() => {
  fs.rmSync(alphaRoot, { recursive: true, force: true });
});

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

const modelSettings = {
  sanitize: vi.fn(() => sanitizedSettings),
  apply: vi.fn(() => sanitizedSettings),
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
    modelSettings,
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
    expect(modelSettings.sanitize).toHaveBeenCalled();
    expect(sent()[0].data).toEqual(sanitizedSettings);
  });

  it("settings.updateModels delegates to the model settings port", async () => {
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
    const { sent } = await call("settings.updateModels", request);
    expect(modelSettings.apply).toHaveBeenCalledWith(request);
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

describe("rpc settings methods (model settings through the real port)", () => {
  const originalAnthropicKey = process.env.ANTHROPIC_API_KEY;
  let tmpDir: string;
  let filePath: string;
  let store: ModelSettingsStore;
  let registry: {
    setDefaultModel: ReturnType<typeof vi.fn>;
    setSampling: ReturnType<typeof vi.fn>;
    setThinkingLevel: ReturnType<typeof vi.fn>;
  };
  let harness: RpcHarness;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "rpc-settings-models-"));
    filePath = path.join(tmpDir, "model-settings.json");
    store = new ModelSettingsStore({ filePath });
    registry = { setDefaultModel: vi.fn(), setSampling: vi.fn(), setThinkingLevel: vi.fn() };
    harness = createRpcHarness({
      methods: settingsMethods,
      modelSettings: {
        ...createRpcModelSettings(
          store,
          new ModelCatalog(),
          registry as unknown as ProjectRegistry,
        ),
      },
    });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  afterAll(() => {
    if (originalAnthropicKey === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = originalAnthropicKey;
  });

  const readPersisted = () => JSON.parse(fs.readFileSync(filePath, "utf-8"));

  it("settings.getModels returns empty sanitized settings by default", async () => {
    const frame = await callMethod(harness, "settings.getModels", undefined);
    expect(frame).toMatchObject({ type: "result", ok: true });
    expect(frame.data).toEqual({
      models: {
        text: { defaultModel: "", providers: {} },
        image: { defaultModel: "", providers: {} },
      },
      customProviders: [],
    });
  });

  it("settings.updateModels round-trips settings without leaking api keys", async () => {
    const frame = await callMethod(harness, "settings.updateModels", {
      models: {
        text: {
          defaultModel: "anthropic/claude-sonnet-4",
          providers: { anthropic: { apiKey: "sk-secret" } },
          sampling: { temperature: 0.4 },
          thinkingLevel: "high",
        },
        image: { defaultModel: "", providers: {} },
      },
    });
    expect(frame).toMatchObject({ type: "result", ok: true });
    const body = frame.data as ModelSettingsResponse;
    expect(body.models.text.defaultModel).toBe("anthropic/claude-sonnet-4");
    expect(body.models.text.providers).toEqual({ anthropic: { configured: true } });
    expect(body.models.text.sampling).toEqual({ temperature: 0.4 });
    expect(body.models.text.thinkingLevel).toBe("high");
    expect(JSON.stringify(frame)).not.toContain("sk-secret");

    expect(store.get().text.providers.anthropic?.apiKey).toBe("sk-secret");
    expect(readPersisted().text.providers.anthropic.apiKey).toBe("sk-secret");
  });

  it("settings.updateModels clears the key when apiKey is empty", async () => {
    await callMethod(harness, "settings.updateModels", {
      models: {
        text: { defaultModel: "m", providers: { anthropic: { apiKey: "sk-secret" } } },
        image: { defaultModel: "" },
      },
    });
    const frame = await callMethod(harness, "settings.updateModels", {
      models: {
        text: { defaultModel: "m", providers: { anthropic: { apiKey: "" } } },
        image: { defaultModel: "" },
      },
    });
    expect(frame).toMatchObject({ type: "result", ok: true });
    expect((frame.data as ModelSettingsResponse).models.text.providers).toEqual({});
    expect(store.get().text.providers).toEqual({});
  });

  it("settings.updateModels rejects an invalid payload and leaves the store untouched", async () => {
    const frame = await callMethod(harness, "settings.updateModels", {
      models: {
        text: { defaultModel: "", thinkingLevel: "xhigh" },
        image: { defaultModel: "" },
      },
    });
    expect(frame).toMatchObject({ type: "result", ok: false, error: { code: -32602 } });
    expect(store.get()).toEqual({
      text: { defaultModel: "", providers: {} },
      image: { defaultModel: "", providers: {} },
      customProviders: [],
    });
    expect(fs.existsSync(filePath)).toBe(false);
  });
});
