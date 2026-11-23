import { describe, expect, it } from "vitest";
import { ModelCatalog } from "../../model-providers/catalog.js";

describe("ModelCatalog instances", () => {
  it("do not share custom provider state", () => {
    const a = new ModelCatalog();
    const b = new ModelCatalog();

    a.syncCustomProviders([{ id: "custom-one", name: "One", baseUrl: "https://one", models: ["m1"] }], {});

    expect(Object.keys(a.getSupportedProviders())).toContain("custom-one");
    expect(Object.keys(b.getSupportedProviders())).not.toContain("custom-one");
  });

  it("resolve models independently after divergent syncs", () => {
    const a = new ModelCatalog();
    const b = new ModelCatalog();
    a.syncCustomProviders([{ id: "ca", name: "A", baseUrl: "https://a", models: ["mA"] }], {});
    b.syncCustomProviders([{ id: "cb", name: "B", baseUrl: "https://b", models: ["mB"] }], {});

    expect(a.resolveModelById("ca/mA").provider).toBe("ca");
    expect(b.resolveModelById("cb/mB").provider).toBe("cb");
    expect(() => a.resolveModelById("cb/mB")).toThrow(/Could not resolve model/);
  });
});

describe("ModelCatalog provider api key injection", () => {
  it("injects keys over env and clears them", async () => {
    const saved = process.env.DEEPSEEK_API_KEY;
    delete process.env.DEEPSEEK_API_KEY;
    try {
      const catalog = new ModelCatalog();
      const models = catalog.getChatModels();
      expect(await models.checkAuth("deepseek")).toBeUndefined();
      catalog.setProviderApiKeys({ deepseek: "sk-injected" });
      expect(await models.checkAuth("deepseek")).toMatchObject({ type: "api_key" });
      expect(catalog.getProviderApiKey("deepseek")).toBe("sk-injected");
      catalog.setProviderApiKeys({});
      expect(await models.checkAuth("deepseek")).toBeUndefined();
    } finally {
      if (saved !== undefined) process.env.DEEPSEEK_API_KEY = saved;
    }
  });
});
