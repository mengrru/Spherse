import { describe, it, expect, vi, afterEach } from "vitest";
import {
  resolveOpenaiImageModel,
  generateImagesOpenai,
  OPENAI_IMAGE_MODELS,
  createOpenaiImagesProvider,
} from "../model-providers/openai-images.js";

const SAMPLE_MODEL = {
  id: "gpt-image-2",
  name: "GPT Image 2",
  api: "openai-images",
  provider: "openai",
  baseUrl: "https://api.openai.com/v1",
  input: ["text"],
  output: ["image"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
} as const;

const DALLE_MODEL = {
  ...SAMPLE_MODEL,
  id: "dall-e-3",
  name: "DALL·E 3",
} as const;

describe("OPENAI_IMAGE_MODELS", () => {
  it("contains the expected GPT image lineup plus dall-e-3", () => {
    const ids = Object.keys(OPENAI_IMAGE_MODELS);
    expect(ids).toContain("gpt-image-2");
    expect(ids).toContain("gpt-image-1.5");
    expect(ids).toContain("gpt-image-1");
    expect(ids).toContain("gpt-image-1-mini");
    expect(ids).toContain("dall-e-3");
    expect(ids).not.toContain("dall-e-2");
  });

  it("each model has correct shape", () => {
    for (const m of Object.values(OPENAI_IMAGE_MODELS)) {
      expect(m.provider).toBe("openai");
      expect(m.api).toBe("openai-images");
      expect(m.output).toContain("image");
      expect(m.baseUrl).toBe("https://api.openai.com/v1");
    }
  });
});

describe("resolveOpenaiImageModel", () => {
  it("returns ImagesModel literal for known model", () => {
    const model = resolveOpenaiImageModel("gpt-image-2");
    expect(model.id).toBe("gpt-image-2");
    expect(model.api).toBe("openai-images");
    expect(model.provider).toBe("openai");
    expect(model.output).toContain("image");
  });

  it("includes baseUrl and cost", () => {
    const model = resolveOpenaiImageModel("gpt-image-1");
    expect(typeof model.baseUrl).toBe("string");
    expect(model.cost).toBeDefined();
  });

  it("throws for unknown model", () => {
    expect(() => resolveOpenaiImageModel("nonexistent")).toThrow();
  });
});

describe("generateImagesOpenai", () => {
  const baseContext = {
    input: [{ type: "text" as const, text: "一只猫" }],
  };

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("normalizes b64_json response to ImageContent", async () => {
    const b64 = "aGVsbG8=";
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        data: [{ b64_json: b64 }],
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await generateImagesOpenai(SAMPLE_MODEL as any, baseContext as any, {
      apiKey: "test-key",
    });

    expect(result.stopReason).toBe("stop");
    expect(result.output).toHaveLength(1);
    expect(result.output[0].type).toBe("image");
    if (result.output[0].type === "image") {
      expect(result.output[0].data).toBe(b64);
      expect(result.output[0].mimeType).toMatch(/^image\//);
    }

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain("/images/generations");
    const body = JSON.parse((init as any).body);
    expect(body.model).toBe("gpt-image-2");
    expect(body.prompt).toBe("一只猫");
    expect(body.n).toBe(1);
    expect((init as any).headers.Authorization).toBe("Bearer test-key");
  });

  it("does not send response_format for GPT image models", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ data: [{ b64_json: "x" }] }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await generateImagesOpenai(SAMPLE_MODEL as any, baseContext as any, { apiKey: "k" });

    const body = JSON.parse((fetchMock.mock.calls[0][1] as any).body);
    expect(body.response_format).toBeUndefined();
  });

  it("sends response_format b64_json for dall-e-3", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ data: [{ b64_json: "x" }] }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await generateImagesOpenai(DALLE_MODEL as any, baseContext as any, { apiKey: "k" });

    const body = JSON.parse((fetchMock.mock.calls[0][1] as any).body);
    expect(body.response_format).toBe("b64_json");
    expect(body.model).toBe("dall-e-3");
  });

  it("passes size and quality into request body when provided", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ data: [{ b64_json: "x" }] }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await generateImagesOpenai(SAMPLE_MODEL as any, baseContext as any, {
      apiKey: "k",
      size: "1536x1024",
      quality: "high",
    });

    const body = JSON.parse((fetchMock.mock.calls[0][1] as any).body);
    expect(body.size).toBe("1536x1024");
    expect(body.quality).toBe("high");
  });

  it("omits size and quality when not provided", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ data: [{ b64_json: "x" }] }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await generateImagesOpenai(SAMPLE_MODEL as any, baseContext as any, { apiKey: "k" });

    const body = JSON.parse((fetchMock.mock.calls[0][1] as any).body);
    expect(body.size).toBeUndefined();
    expect(body.quality).toBeUndefined();
  });

  it("normalizes url response by fetching and converting to base64", async () => {
    const imageBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          data: [{ url: "https://example.com/img.png" }],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({ "content-type": "image/png" }),
        arrayBuffer: async () => imageBytes.buffer,
      });
    vi.stubGlobal("fetch", fetchMock);

    const result = await generateImagesOpenai(DALLE_MODEL as any, baseContext as any, {
      apiKey: "test-key",
    });

    expect(result.stopReason).toBe("stop");
    expect(result.output).toHaveLength(1);
    if (result.output[0].type === "image") {
      expect(result.output[0].mimeType).toBe("image/png");
      const decoded = Buffer.from(result.output[0].data, "base64");
      expect(Array.from(decoded)).toEqual([0x89, 0x50, 0x4e, 0x47]);
    }
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("returns stopReason error on non-200 response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        json: async () => ({ error: { message: "invalid api key" } }),
      }),
    );

    const result = await generateImagesOpenai(SAMPLE_MODEL as any, baseContext as any, {
      apiKey: "bad-key",
    });

    expect(result.stopReason).toBe("error");
    expect(result.errorMessage).toBeTruthy();
    expect(result.output).toHaveLength(0);
  });

  it("returns stopReason error when response has no image data", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ data: [] }),
      }),
    );

    const result = await generateImagesOpenai(SAMPLE_MODEL as any, baseContext as any, {
      apiKey: "test-key",
    });

    expect(result.stopReason).toBe("error");
    expect(result.errorMessage).toBeTruthy();
  });

  it("returns stopReason error when apiKey is missing", async () => {
    const result = await generateImagesOpenai(SAMPLE_MODEL as any, baseContext as any, {});
    expect(result.stopReason).toBe("error");
    expect(result.errorMessage).toContain("api");
  });

  it("returns stopReason aborted when signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const result = await generateImagesOpenai(SAMPLE_MODEL as any, baseContext as any, {
      apiKey: "test-key",
      signal: controller.signal,
    });
    expect(result.stopReason).toBe("aborted");
  });
});

describe("createOpenaiImagesProvider", () => {
  it("returns provider with correct id and generateImages function", () => {
    const provider = createOpenaiImagesProvider();
    expect(provider.id).toBe("openai");
    expect(provider.name).toBe("OpenAI");
    expect(typeof provider.generateImages).toBe("function");
    expect(provider.getModels().length).toBeGreaterThan(0);
  });
});
