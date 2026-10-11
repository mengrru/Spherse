import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import { ModelCatalog } from "@spherse/core";
import { registerSettingsRoutes } from "../routes/settings.js";
import { ModelSettingsStore } from "../model-settings.js";
import type { ProjectRegistry } from "../registry.js";

describe("model settings routes", () => {
  let tmpDir: string;
  let app: FastifyInstance;
  let store: ModelSettingsStore;
  const originalAnthropicKey = process.env.ANTHROPIC_API_KEY;

  afterAll(() => {
    if (originalAnthropicKey === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = originalAnthropicKey;
  });

  beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "spherse-model-settings-routes-"));
    store = new ModelSettingsStore({ filePath: path.join(tmpDir, "model-settings.json") });
    const registry = {
      setDefaultModel: (model: string) => {
        appliedDefaultModel = model;
      },
      setSampling: (sampling: unknown) => {
        appliedSampling = sampling;
      },
      setThinkingLevel: (level: unknown) => {
        appliedThinkingLevel = level;
      },
      getSupportedProviders: () => new ModelCatalog().getSupportedProviders(),
    } as unknown as ProjectRegistry;
    app = Fastify();
    registerSettingsRoutes(app, registry, { modelSettingsStore: store, modelCatalog: new ModelCatalog() });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("GET returns empty sanitized settings by default", async () => {
    const res = await app.inject({ method: "GET", url: "/api/settings/models" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      models: {
        text: { defaultModel: "", providers: {} },
        image: { defaultModel: "", providers: {} },
      },
      customProviders: [],
    });
  });

  it("PUT round-trips settings without leaking api keys", async () => {
    const res = await app.inject({
      method: "PUT",
      url: "/api/settings/models",
      payload: {
        models: {
          text: {
            defaultModel: "anthropic/claude-sonnet-4",
            providers: { anthropic: { apiKey: "sk-secret" } },
            sampling: { temperature: 0.4 },
            thinkingLevel: "high",
          },
          image: { defaultModel: "", providers: {} },
        },
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.models.text.defaultModel).toBe("anthropic/claude-sonnet-4");
    expect(body.models.text.providers).toEqual({ anthropic: { configured: true } });
    expect(body.models.text.sampling).toEqual({ temperature: 0.4 });
    expect(body.models.text.thinkingLevel).toBe("high");
    expect(JSON.stringify(body)).not.toContain("sk-secret");

    expect(store.get().text.providers.anthropic?.apiKey).toBe("sk-secret");
    const persisted = JSON.parse(fs.readFileSync(path.join(tmpDir, "model-settings.json"), "utf-8"));
    expect(persisted.text.providers.anthropic.apiKey).toBe("sk-secret");
  });

  it("PUT with empty apiKey clears the key", async () => {
    await app.inject({
      method: "PUT",
      url: "/api/settings/models",
      payload: {
        models: {
          text: { defaultModel: "m", providers: { anthropic: { apiKey: "sk-secret" } } },
          image: { defaultModel: "" },
        },
      },
    });
    const res = await app.inject({
      method: "PUT",
      url: "/api/settings/models",
      payload: {
        models: {
          text: { defaultModel: "m", providers: { anthropic: { apiKey: "" } } },
          image: { defaultModel: "" },
        },
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().models.text.providers).toEqual({});
    expect(store.get().text.providers).toEqual({});
  });

  it("PUT fans out model config to the registry with the empty-model guard", async () => {
    appliedDefaultModel = undefined;
    const res = await app.inject({
      method: "PUT",
      url: "/api/settings/models",
      payload: {
        models: {
          text: { defaultModel: "openai/gpt-4o", sampling: { temperature: 0.9 }, thinkingLevel: "low" },
          image: { defaultModel: "" },
        },
      },
    });
    expect(res.statusCode).toBe(200);
    expect(appliedDefaultModel).toBe("openai/gpt-4o");
    expect(appliedSampling).toEqual({ temperature: 0.9 });
    expect(appliedThinkingLevel).toBe("low");

    appliedDefaultModel = "stale";
    await app.inject({
      method: "PUT",
      url: "/api/settings/models",
      payload: {
        models: {
          text: { defaultModel: "" },
          image: { defaultModel: "" },
        },
      },
    });
    expect(appliedDefaultModel).toBe("stale");
  });

  it("PUT rejects an invalid payload", async () => {
    const res = await app.inject({
      method: "PUT",
      url: "/api/settings/models",
      payload: {
        models: {
          text: { defaultModel: "", thinkingLevel: "xhigh" },
          image: { defaultModel: "" },
        },
      },
    });
    expect(res.statusCode).toBe(400);
  });
});

let appliedDefaultModel: string | undefined;
let appliedSampling: unknown;
let appliedThinkingLevel: unknown;
