import { describe, it, expect, vi, afterEach } from "vitest";
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

  describe("image catalog compatibility", () => {
    afterEach(() => {
      vi.unstubAllGlobals();
      vi.unstubAllEnvs();
    });

    it("exposes only existing image providers and never lists chat models as image models", () => {
      const catalog = new ModelCatalog();
      const images = catalog.getImageSupportedProviders();
      expect(Object.keys(images).sort()).toEqual(["openai", "openrouter", "zhipu"]);
      for (const provider of Object.values(images)) {
        expect(provider.auth.envKeys).toEqual(["SPHERSE_IMAGE_API_KEY"]);
        expect(provider.models.length).toBeGreaterThan(0);
        for (const model of provider.models) {
          expect(catalog.getImagesModels().getModelOfType("image", provider.id, model.id)?.type).toBe("image");
        }
      }
      expect(images.openai.models.map((model) => model.id).sort())
        .toEqual(["dall-e-3", "gpt-image-1", "gpt-image-1-mini", "gpt-image-1.5", "gpt-image-2"]);
      expect(images.zhipu.models.map((model) => model.id)).toEqual(["glm-image"]);
      expect(catalog.getChatModels().getModels("openai").length).toBeGreaterThan(0);
      expect(catalog.getChatModels().getModels("openai").every((model) => model.type === undefined || model.type === "chat")).toBe(true);
      expect(() => catalog.resolveModelById("openai/gpt-image-2")).toThrow("Could not resolve model");
    });

    it.each([
      ["openai", "gpt-image-2", "https://api.openai.com/v1/images/generations"],
      ["zhipu", "glm-image", "https://open.bigmodel.cn/api/paas/v4/images/generations"],
    ])("dispatches %s images through the real catalog with independent credentials", async (provider, id, endpoint) => {
      const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({
        data: [{ b64_json: "aGVsbG8=" }],
      }), { status: 200, headers: { "content-type": "application/json" } }));
      vi.stubGlobal("fetch", fetch);
      vi.stubEnv("OPENAI_API_KEY", "chat-key");
      vi.stubEnv("SPHERSE_IMAGE_API_KEY", "image-key");
      const catalog = new ModelCatalog();
      const images = catalog.getImagesModels();
      const model = images.getModelOfType("image", provider, id);
      if (!model) throw new Error(`Image model not found: ${provider}/${id}`);
      const options = { size: "1024x1024", quality: "high" };

      const result = await images.generateImages(model, { input: [{ type: "text", text: "a cat" }] }, options);

      expect(result.stopReason).toBe("stop");
      expect(result.output).toEqual([{ type: "image", data: "aGVsbG8=", mimeType: "image/png" }]);
      expect(fetch).toHaveBeenCalledTimes(1);
      const [url, init] = fetch.mock.calls[0];
      expect(url).toBe(endpoint);
      expect(new Headers(init.headers).get("authorization")).toBe("Bearer image-key");
      expect(JSON.parse(init.body)).toMatchObject({ model: id, prompt: "a cat", size: "1024x1024" });
      if (provider === "openai") expect(JSON.parse(init.body).quality).toBe("high");
      expect(catalog.getChatModels().getModels("openai").length).toBeGreaterThan(0);
    });

    it("dispatches OpenRouter image models with the explicit image key, not the chat environment key", async () => {
      const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({
        choices: [{ message: { role: "assistant", content: "", images: [
          { type: "image_url", image_url: { url: "data:image/png;base64,aGVsbG8=" } },
        ] }, finish_reason: "stop" }],
      }), { status: 200, headers: { "content-type": "application/json" } }));
      vi.stubGlobal("fetch", fetch);
      vi.stubEnv("OPENROUTER_API_KEY", "chat-key");
      const images = new ModelCatalog().getImagesModels();
      const model = images.getModelsOfType("image", "openrouter")[0];
      if (!model) throw new Error("OpenRouter image model not found");

      const result = await images.generateImages(
        model,
        { input: [{ type: "text", text: "a cat" }] },
        { apiKey: "image-key" },
      );

      expect(result.stopReason).toBe("stop");
      expect(result.output).toContainEqual({ type: "image", data: "aGVsbG8=", mimeType: "image/png" });
      expect(fetch).toHaveBeenCalledTimes(1);
      const [, init] = fetch.mock.calls[0];
      expect(new Headers(init.headers).get("authorization")).toBe("Bearer image-key");
      expect(JSON.parse(init.body).modalities).toContain("image");
    });
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
