import { describe, expect, it } from "vitest";
import type { ProviderCatalogItem } from "@spherse/core";
import { modelExistsInCatalog } from "./ModelConfigField";

const catalog: Record<string, ProviderCatalogItem> = {
  openai: {
    id: "openai",
    name: "OpenAI",
    auth: { type: "apiKey", envKeys: ["OPENAI_API_KEY"] },
    models: [
      {
        id: "gpt-4o",
        name: "GPT-4o",
        provider: "openai",
        api: "openai",
        reasoning: false,
        input: ["text"],
      },
    ],
  },
  deepseek: {
    id: "deepseek",
    name: "DeepSeek",
    auth: { type: "apiKey", envKeys: ["DEEPSEEK_API_KEY"] },
    models: [
      {
        id: "deepseek-chat",
        name: "DeepSeek Chat",
        provider: "deepseek",
        api: "openai",
        reasoning: false,
        input: ["text"],
      },
    ],
  },
};

describe("modelExistsInCatalog", () => {
  it("matches provider-qualified model ids", () => {
    expect(modelExistsInCatalog("openai/gpt-4o", catalog)).toBe(true);
    expect(modelExistsInCatalog("openai/gpt-5", catalog)).toBe(false);
    expect(modelExistsInCatalog("unknown/gpt-4o", catalog)).toBe(false);
  });

  it("matches bare model ids across all providers", () => {
    expect(modelExistsInCatalog("gpt-4o", catalog)).toBe(true);
    expect(modelExistsInCatalog("deepseek-chat", catalog)).toBe(true);
    expect(modelExistsInCatalog("not-a-model", catalog)).toBe(false);
  });

  it("returns false for unknown ids against an empty catalog", () => {
    expect(modelExistsInCatalog("openai/gpt-4o", {})).toBe(false);
    expect(modelExistsInCatalog("gpt-4o", {})).toBe(false);
  });
});
