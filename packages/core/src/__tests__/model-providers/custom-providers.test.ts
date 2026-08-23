import { describe, it, expect, afterEach } from "vitest";
import { ModelCatalog } from "../../model-providers/catalog.js";

const KEYLESS_PLACEHOLDER = "sk-no-key";

const catalog = new ModelCatalog();

afterEach(() => {
  catalog.syncCustomProviders([], {});
});

describe("syncCustomProviders add", () => {
  it("registers a custom provider so it appears in getSupportedProviders", () => {
    catalog.syncCustomProviders(
      [{ id: "custom-foo", name: "Foo", baseUrl: "https://foo.example.com/v1", models: ["model-a"], keyless: false }],
      {},
    );

    const supported = catalog.getSupportedProviders();
    expect(supported["custom-foo"]).toBeDefined();
    expect(supported["custom-foo"].custom).toBe(true);
    expect(supported["custom-foo"].name).toBe("Foo");
    expect(supported["custom-foo"].baseUrl).toBe("https://foo.example.com/v1");
    expect(supported["custom-foo"].keyless).toBe(false);
    expect(supported["custom-foo"].auth.type).toBe("apiKey");
    expect(supported["custom-foo"].models).toHaveLength(1);
    expect(supported["custom-foo"].models[0]).toMatchObject({
      id: "model-a",
      name: "model-a",
      provider: "custom-foo",
      api: "openai-completions",
      reasoning: false,
      contextWindow: 131072,
      maxTokens: 131072,
    });
  });

  it("exposes a keyless custom provider with unknown auth type in the catalog", () => {
    catalog.syncCustomProviders(
      [{ id: "custom-bar", name: "Bar", baseUrl: "https://bar.example.com/v1", models: ["m1"], keyless: true }],
      {},
    );

    const supported = catalog.getSupportedProviders();
    expect(supported["custom-bar"].custom).toBe(true);
    expect(supported["custom-bar"].keyless).toBe(true);
    expect(supported["custom-bar"].auth.type).toBe("unknown");
  });

  it("resolves a custom model by id carrying the provider baseUrl and openai-completions api", () => {
    catalog.syncCustomProviders(
      [{ id: "custom-foo", name: "Foo", baseUrl: "https://foo.example.com/v1", models: ["model-a"], keyless: false }],
      {},
    );

    const model = catalog.resolveModelById("custom-foo/model-a");
    expect(model).toBeDefined();
    expect(model.baseUrl).toBe("https://foo.example.com/v1");
    expect(model.api).toBe("openai-completions");
    expect(model.provider).toBe("custom-foo");
  });
});

describe("syncCustomProviders custom limits", () => {
  it("applies provider-level contextWindow and maxTokens to registered models", () => {
    catalog.syncCustomProviders(
      [
        {
          id: "custom-lim",
          name: "Lim",
          baseUrl: "https://lim.example.com/v1",
          models: ["model-a", "model-b"],
          keyless: false,
          contextWindow: 200000,
          maxTokens: 32000,
        },
      ],
      {},
    );

    const supported = catalog.getSupportedProviders();
    expect(supported["custom-lim"].models).toHaveLength(2);
    for (const model of supported["custom-lim"].models) {
      expect(model.contextWindow).toBe(200000);
      expect(model.maxTokens).toBe(32000);
    }

    const model = catalog.resolveModelById("custom-lim/model-a");
    expect(model.contextWindow).toBe(200000);
    expect(model.maxTokens).toBe(32000);
  });

  it("falls back to default limits when the def omits them", () => {
    catalog.syncCustomProviders(
      [{ id: "custom-def", name: "Def", baseUrl: "https://def.example.com/v1", models: ["m1"], keyless: false }],
      {},
    );

    const model = catalog.resolveModelById("custom-def/m1");
    expect(model.contextWindow).toBe(131072);
    expect(model.maxTokens).toBe(131072);
  });

  it("reflects updated limits after re-syncing the same id", () => {
    catalog.syncCustomProviders(
      [
        {
          id: "custom-upd",
          name: "Upd",
          baseUrl: "https://upd.example.com/v1",
          models: ["m1"],
          keyless: false,
          contextWindow: 131072,
          maxTokens: 8192,
        },
      ],
      {},
    );

    catalog.syncCustomProviders(
      [
        {
          id: "custom-upd",
          name: "Upd",
          baseUrl: "https://upd.example.com/v1",
          models: ["m1"],
          keyless: false,
          contextWindow: 262144,
          maxTokens: 16384,
        },
      ],
      {},
    );

    const model = catalog.resolveModelById("custom-upd/m1");
    expect(model.contextWindow).toBe(262144);
    expect(model.maxTokens).toBe(16384);
  });
});

describe("syncCustomProviders update", () => {
  it("reflects updated name and baseUrl after re-syncing the same id", () => {
    catalog.syncCustomProviders(
      [{ id: "custom-foo", name: "Foo", baseUrl: "https://foo.example.com/v1", models: ["model-a"], keyless: false }],
      {},
    );

    catalog.syncCustomProviders(
      [{ id: "custom-foo", name: "Foo Renamed", baseUrl: "https://foo2.example.com/v1", models: ["model-a"], keyless: false }],
      {},
    );

    const supported = catalog.getSupportedProviders();
    expect(supported["custom-foo"].name).toBe("Foo Renamed");
    expect(supported["custom-foo"].baseUrl).toBe("https://foo2.example.com/v1");

    const model = catalog.resolveModelById("custom-foo/model-a");
    expect(model.baseUrl).toBe("https://foo2.example.com/v1");
  });
});

describe("syncCustomProviders remove", () => {
  it("removes a custom provider when it is missing from the next sync", () => {
    catalog.syncCustomProviders(
      [{ id: "custom-foo", name: "Foo", baseUrl: "https://foo.example.com/v1", models: ["model-a"], keyless: false }],
      {},
    );
    expect(catalog.getSupportedProviders()["custom-foo"]).toBeDefined();

    catalog.syncCustomProviders([], {});
    const supported = catalog.getSupportedProviders();
    expect(supported["custom-foo"]).toBeUndefined();
  });
});

describe("custom provider auth resolution", () => {
  it("returns the keyless placeholder for a keyless provider with no api key", async () => {
    catalog.syncCustomProviders(
      [{ id: "custom-keyless", name: "Keyless", baseUrl: "https://k.example.com/v1", models: ["m"], keyless: true }],
      {},
    );

    const provider = catalog.getChatModels().getProvider("custom-keyless");
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
    catalog.syncCustomProviders(
      [{ id: "custom-keyed", name: "Keyed", baseUrl: "https://k.example.com/v1", models: ["m"], keyless: false }],
      { "custom-keyed": "sk-real-key-123" },
    );

    const provider = catalog.getChatModels().getProvider("custom-keyed");
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
    catalog.syncCustomProviders(
      [{ id: "custom-missing", name: "Missing", baseUrl: "https://k.example.com/v1", models: ["m"], keyless: false }],
      {},
    );

    const provider = catalog.getChatModels().getProvider("custom-missing");
    expect(provider).toBeDefined();
    const result = await provider!.auth.apiKey!.resolve({
      model: { provider: "custom-missing" } as never,
      ctx: { env: async () => undefined, fileExists: async () => false } as never,
      credential: undefined,
    });
    expect(result).toBeUndefined();
  });
});
