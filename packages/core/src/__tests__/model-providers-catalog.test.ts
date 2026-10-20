import { describe, it, expect } from "vitest";
import { ModelCatalog, ENABLED_PROVIDERS } from "../model-providers/catalog.js";

const EXPECTED_ENV_KEYS: Record<string, string[]> = {
  openai: ["OPENAI_API_KEY"],
  anthropic: ["ANTHROPIC_API_KEY"],
  google: ["GEMINI_API_KEY"],
  deepseek: ["DEEPSEEK_API_KEY"],
  zai: ["ZAI_API_KEY"],
  minimax: ["MINIMAX_API_KEY"],
  "minimax-cn": ["MINIMAX_CN_API_KEY"],
  xiaomi: ["XIAOMI_API_KEY"],
  moonshotai: ["MOONSHOT_API_KEY"],
  "moonshotai-cn": ["MOONSHOT_API_KEY"],
  xai: ["XAI_API_KEY"],
  openrouter: ["OPENROUTER_API_KEY"],
  "kimi-coding": ["KIMI_API_KEY"],
  "opencode-go": ["OPENCODE_API_KEY"],
};

describe("getSupportedProviders catalog", () => {
  const catalog = new ModelCatalog().getSupportedProviders();

  it("exposes every ENABLED_PROVIDERS entry with at least one model", () => {
    for (const id of ENABLED_PROVIDERS) {
      expect(catalog[id], `provider ${id} missing from catalog`).toBeDefined();
      expect(catalog[id].models.length, `provider ${id} has no models`).toBeGreaterThan(0);
    }
  });

  it("maps each provider to the correct env key for env injection", () => {
    for (const [id, envKeys] of Object.entries(EXPECTED_ENV_KEYS)) {
      expect(catalog[id].auth.envKeys, `provider ${id} env keys`).toEqual(envKeys);
    }
  });

  it("classifies all enabled providers as apiKey auth type", () => {
    for (const id of ENABLED_PROVIDERS) {
      expect(catalog[id].auth.type, `provider ${id} auth type`).toBe("apiKey");
    }
  });

  it("does not leak providers that are not enabled", () => {
    expect(catalog["github-copilot"]).toBeUndefined();
    expect(catalog["groq"]).toBeUndefined();
    expect(catalog["together"]).toBeUndefined();
    expect(catalog["mistral"]).toBeUndefined();
    expect(catalog["fireworks"]).toBeUndefined();
    expect(catalog["cerebras"]).toBeUndefined();
    expect(catalog["nvidia"]).toBeUndefined();
  });
});

describe("getImageSupportedProviders catalog", () => {
  const imageCatalog = new ModelCatalog().getImageSupportedProviders();

  it("exposes zhipu, openai, openrouter and seedream image providers", () => {
    expect(imageCatalog["zhipu"]).toBeDefined();
    expect(imageCatalog["openai"]).toBeDefined();
    expect(imageCatalog["openrouter"]).toBeDefined();
    expect(imageCatalog["seedream"]).toBeDefined();
  });

  it("registers seedream with 5 models, display name and shared env key", () => {
    const seedream = imageCatalog["seedream"];
    expect(seedream.models).toHaveLength(5);
    expect(seedream.name).toBe("Seedream");
    expect(seedream.auth.type).toBe("apiKey");
    expect(seedream.auth.envKeys).toEqual(["SPHERSE_IMAGE_API_KEY"]);
    expect(seedream.models.every((m) => m.provider === "seedream" && m.api === "seedream-images")).toBe(
      true,
    );
  });
});
