import { describe, it, expect, afterEach } from "vitest";
import {
  syncCustomProviders,
  getSupportedProviders,
  resolveModelById,
  getChatModels,
} from "../../model-providers/index.js";

const KEYLESS_PLACEHOLDER = "sk-no-key";

afterEach(() => {
  syncCustomProviders([], {});
});

describe("syncCustomProviders add", () => {
  it("registers a custom provider so it appears in getSupportedProviders", () => {
    syncCustomProviders(
      [{ id: "custom-foo", name: "Foo", baseUrl: "https://foo.example.com/v1", models: ["model-a"], keyless: false }],
      {},
    );

    const catalog = getSupportedProviders();
    expect(catalog["custom-foo"]).toBeDefined();
    expect(catalog["custom-foo"].custom).toBe(true);
    expect(catalog["custom-foo"].name).toBe("Foo");
    expect(catalog["custom-foo"].baseUrl).toBe("https://foo.example.com/v1");
    expect(catalog["custom-foo"].keyless).toBe(false);
    expect(catalog["custom-foo"].auth.type).toBe("apiKey");
    expect(catalog["custom-foo"].models).toHaveLength(1);
    expect(catalog["custom-foo"].models[0]).toMatchObject({
      id: "model-a",
      name: "model-a",
      provider: "custom-foo",
      api: "openai-completions",
      reasoning: false,
      contextWindow: 32768,
      maxTokens: 4096,
    });
  });

  it("exposes a keyless custom provider with unknown auth type in the catalog", () => {
    syncCustomProviders(
      [{ id: "custom-bar", name: "Bar", baseUrl: "https://bar.example.com/v1", models: ["m1"], keyless: true }],
      {},
    );

    const catalog = getSupportedProviders();
    expect(catalog["custom-bar"].custom).toBe(true);
    expect(catalog["custom-bar"].keyless).toBe(true);
    expect(catalog["custom-bar"].auth.type).toBe("unknown");
  });

  it("resolves a custom model by id carrying the provider baseUrl and openai-completions api", () => {
    syncCustomProviders(
      [{ id: "custom-foo", name: "Foo", baseUrl: "https://foo.example.com/v1", models: ["model-a"], keyless: false }],
      {},
    );

    const model = resolveModelById("custom-foo/model-a");
    expect(model).toBeDefined();
    expect(model.baseUrl).toBe("https://foo.example.com/v1");
    expect(model.api).toBe("openai-completions");
    expect(model.provider).toBe("custom-foo");
  });
});

describe("syncCustomProviders update", () => {
  it("reflects updated name and baseUrl after re-syncing the same id", () => {
    syncCustomProviders(
      [{ id: "custom-foo", name: "Foo", baseUrl: "https://foo.example.com/v1", models: ["model-a"], keyless: false }],
      {},
    );

    syncCustomProviders(
      [{ id: "custom-foo", name: "Foo Renamed", baseUrl: "https://foo2.example.com/v1", models: ["model-a"], keyless: false }],
      {},
    );

    const catalog = getSupportedProviders();
    expect(catalog["custom-foo"].name).toBe("Foo Renamed");
    expect(catalog["custom-foo"].baseUrl).toBe("https://foo2.example.com/v1");

    const model = resolveModelById("custom-foo/model-a");
    expect(model.baseUrl).toBe("https://foo2.example.com/v1");
  });
});

describe("syncCustomProviders remove", () => {
  it("removes a custom provider when it is missing from the next sync", () => {
    syncCustomProviders(
      [{ id: "custom-foo", name: "Foo", baseUrl: "https://foo.example.com/v1", models: ["model-a"], keyless: false }],
      {},
    );
    expect(getSupportedProviders()["custom-foo"]).toBeDefined();

    syncCustomProviders([], {});
    const catalog = getSupportedProviders();
    expect(catalog["custom-foo"]).toBeUndefined();
  });
});

describe("custom provider auth resolution", () => {
  it("returns the keyless placeholder for a keyless provider with no api key", async () => {
    syncCustomProviders(
      [{ id: "custom-keyless", name: "Keyless", baseUrl: "https://k.example.com/v1", models: ["m"], keyless: true }],
      {},
    );

    const provider = getChatModels().getProvider("custom-keyless");
    expect(provider).toBeDefined();
    const result = await provider!.auth.apiKey!.resolve({
      model: { provider: "custom-keyless" } as never,
      ctx: { env: async () => undefined, fileExists: async () => false } as never,
      credential: undefined,
    });
    expect(result).toBeDefined();
    expect(result!.auth.apiKey).toBe(KEYLESS_PLACEHOLDER);
    expect(result!.source).toBe("Keyless");
  });

  it("returns the real api key for a keyed provider when apiKeys map supplies one", async () => {
    syncCustomProviders(
      [{ id: "custom-keyed", name: "Keyed", baseUrl: "https://k.example.com/v1", models: ["m"], keyless: false }],
      { "custom-keyed": "sk-real-key-123" },
    );

    const provider = getChatModels().getProvider("custom-keyed");
    expect(provider).toBeDefined();
    const result = await provider!.auth.apiKey!.resolve({
      model: { provider: "custom-keyed" } as never,
      ctx: { env: async () => undefined, fileExists: async () => false } as never,
      credential: undefined,
    });
    expect(result).toBeDefined();
    expect(result!.auth.apiKey).toBe("sk-real-key-123");
    expect(result!.source).toBe("API Key");
  });

  it("resolves to undefined when a keyed provider has no key and is not keyless", async () => {
    syncCustomProviders(
      [{ id: "custom-missing", name: "Missing", baseUrl: "https://k.example.com/v1", models: ["m"], keyless: false }],
      {},
    );

    const provider = getChatModels().getProvider("custom-missing");
    expect(provider).toBeDefined();
    const result = await provider!.auth.apiKey!.resolve({
      model: { provider: "custom-missing" } as never,
      ctx: { env: async () => undefined, fileExists: async () => false } as never,
      credential: undefined,
    });
    expect(result).toBeUndefined();
  });
});
