import { describe, it, expect } from "vitest";
import { getSupportedProviders, ENABLED_PROVIDERS } from "../model-providers/index.js";

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
};

describe("getSupportedProviders catalog", () => {
  const catalog = getSupportedProviders();

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
