import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ModelCatalog } from "@spherse/core";
import { ModelSettingsStore, applyModelSettingsToEnv } from "../model-settings.js";
import type { ModelSettingsRequest } from "@spherse/contracts";

function writeRequest(overrides?: Partial<ModelSettingsRequest["models"]>, customProviders?: ModelSettingsRequest["customProviders"]): ModelSettingsRequest {
  return {
    models: {
      text: { defaultModel: "", ...overrides?.text },
      image: { defaultModel: "", ...overrides?.image },
    },
    customProviders,
  };
}

describe("ModelSettingsStore", () => {
  it("defaults to empty settings when no file exists", () => {
    const store = new ModelSettingsStore();
    expect(store.get()).toEqual({
      text: { defaultModel: "", providers: {} },
      image: { defaultModel: "", providers: {} },
      customProviders: [],
    });
    expect(store.sanitize().models.text.providers).toEqual({});
  });

  it("loads persisted settings from disk", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "spherse-model-settings-"));
    const filePath = path.join(dir, "model-settings.json");
    fs.writeFileSync(
      filePath,
      JSON.stringify({
        text: { defaultModel: "anthropic/claude-sonnet-4", providers: { anthropic: { apiKey: "sk-real" } }, sampling: { temperature: 0.5 } },
        image: { defaultModel: "", providers: {} },
        customProviders: [],
      }),
    );
    const store = new ModelSettingsStore({ filePath });
    expect(store.get().text.providers.anthropic?.apiKey).toBe("sk-real");
    expect(store.sanitize().models.text.providers).toEqual({ anthropic: { configured: true } });
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("falls back to defaults on corrupt file", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "spherse-model-settings-"));
    const filePath = path.join(dir, "model-settings.json");
    fs.writeFileSync(filePath, "{not json");
    const store = new ModelSettingsStore({ filePath });
    expect(store.get().text.defaultModel).toBe("");
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("merges api keys with tri-state semantics", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "spherse-model-settings-"));
    const filePath = path.join(dir, "model-settings.json");
    const store = new ModelSettingsStore({ filePath });

    store.applyUpdate(writeRequest({ text: { defaultModel: "m", providers: { anthropic: { apiKey: "sk-one" }, openai: { apiKey: "sk-two" } } } }));
    expect(store.get().text.providers).toEqual({
      anthropic: { apiKey: "sk-one" },
      openai: { apiKey: "sk-two" },
    });

    store.applyUpdate(writeRequest({ text: { providers: { anthropic: { apiKey: "sk-new" }, openai: { apiKey: "" }, deepseek: {} } } }));
    expect(store.get().text.providers).toEqual({
      anthropic: { apiKey: "sk-new" },
    });
    expect(store.sanitize().models.text.providers).toEqual({
      anthropic: { configured: true },
    });

    const persisted = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    expect(persisted.text.providers.anthropic.apiKey).toBe("sk-new");
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("replaces non-secret fields with incoming values", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "spherse-model-settings-"));
    const store = new ModelSettingsStore({ filePath: path.join(dir, "model-settings.json") });

    store.applyUpdate(writeRequest({ text: { defaultModel: "a", sampling: { temperature: 1 }, thinkingLevel: "high" } }));
    store.applyUpdate(writeRequest({ text: { defaultModel: "" } }));
    const group = store.get().text;
    expect(group.defaultModel).toBe("");
    expect(group.sampling).toBeUndefined();
    expect(group.thinkingLevel).toBeUndefined();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("replaces customProviders when present and keeps them when absent", () => {
    const store = new ModelSettingsStore();
    const def = {
      id: "custom-x",
      name: "X",
      baseUrl: "https://x.example",
      models: ["x/x-mini"],
      keyless: true,
    };
    store.applyUpdate(writeRequest(undefined, [def]));
    expect(store.get().customProviders).toEqual([def]);
    store.applyUpdate(writeRequest());
    expect(store.get().customProviders).toEqual([def]);
    store.applyUpdate(writeRequest(undefined, []));
    expect(store.get().customProviders).toEqual([]);
  });

  it("in-memory mode does not touch disk", () => {
    const store = new ModelSettingsStore();
    store.applyUpdate(writeRequest({ text: { defaultModel: "m" } }));
    expect(store.get().text.defaultModel).toBe("m");
  });

  it("keeps previous settings in memory when persistence fails", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "spherse-model-settings-"));
    const store = new ModelSettingsStore({ filePath: path.join(dir, "model-settings.json") });
    store.applyUpdate(writeRequest({ text: { defaultModel: "first" } }));
    fs.chmodSync(dir, 0o500);
    try {
      expect(() => store.applyUpdate(writeRequest({ text: { defaultModel: "second" } }))).toThrow();
      expect(store.get().text.defaultModel).toBe("first");
    } finally {
      fs.chmodSync(dir, 0o700);
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("applyModelSettingsToEnv", () => {
  it("injects provider keys into env and restores originals on removal", () => {
    const catalog = new ModelCatalog();
    const original = process.env.ANTHROPIC_API_KEY;
    process.env.ANTHROPIC_API_KEY = "original-shell-key";

    applyModelSettingsToEnv(
      {
        text: { defaultModel: "m", providers: { anthropic: { apiKey: "sk-from-settings" } } },
        image: { defaultModel: "", providers: {} },
        customProviders: [],
      },
      catalog,
    );
    expect(process.env.ANTHROPIC_API_KEY).toBe("sk-from-settings");

    applyModelSettingsToEnv(
      {
        text: { defaultModel: "m", providers: {} },
        image: { defaultModel: "", providers: {} },
        customProviders: [],
      },
      catalog,
    );
    expect(process.env.ANTHROPIC_API_KEY).toBe("original-shell-key");

    if (original === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = original;
  });

  it("sets image env pair from image group", () => {
    const catalog = new ModelCatalog();
    applyModelSettingsToEnv(
      {
        text: { defaultModel: "", providers: {} },
        image: { defaultModel: "openai/gpt-image-2", providers: { openai: { apiKey: "img-key" } } },
        customProviders: [],
      },
      catalog,
    );
    expect(process.env.SPHERSE_IMAGE_MODEL).toBe("openai/gpt-image-2");
    expect(process.env.SPHERSE_IMAGE_API_KEY).toBe("img-key");

    applyModelSettingsToEnv(
      { text: { defaultModel: "", providers: {} }, image: { defaultModel: "", providers: {} }, customProviders: [] },
      catalog,
    );
    expect(process.env.SPHERSE_IMAGE_MODEL).toBeUndefined();
    expect(process.env.SPHERSE_IMAGE_API_KEY).toBeUndefined();
  });

  it("registers custom providers with their api keys on the catalog", () => {
    const catalog = new ModelCatalog();
    const def = {
      id: "custom-y",
      name: "Y",
      baseUrl: "https://y.example/v1",
      models: ["y/y-pro"],
      keyless: false,
    };
    applyModelSettingsToEnv(
      {
        text: { defaultModel: "", providers: { "custom-y": { apiKey: "sk-custom" } } },
        image: { defaultModel: "", providers: {} },
        customProviders: [def],
      },
      catalog,
    );
    const supported = catalog.getSupportedProviders();
    expect(supported["custom-y"]).toBeDefined();
    expect(supported["custom-y"].models.map((m) => m.id)).toContain("y/y-pro");
  });
});
