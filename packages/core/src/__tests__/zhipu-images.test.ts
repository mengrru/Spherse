import { describe, it, expect, vi, afterEach } from "vitest";
import {
  resolveZhipuImageModel,
  generateImagesZhipu,
  ZHIPU_IMAGE_MODELS,
  createZhipuImagesProvider,
} from "../model-providers/zhipu-images.js";

const SAMPLE_MODEL = {
  id: "glm-image",
  name: "GLM Image",
  api: "zhipu-images",
  provider: "zhipu",
  baseUrl: "https://open.bigmodel.cn/api/paas/v4",
  input: ["text"],
  output: ["image"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
} as const;

describe("ZHIPU_IMAGE_MODELS", () => {
  it("contains glm-image with correct shape", () => {
    expect(ZHIPU_IMAGE_MODELS["glm-image"]).toBeDefined();
    const m = ZHIPU_IMAGE_MODELS["glm-image"];
    expect(m.id).toBe("glm-image");
    expect(m.provider).toBe("zhipu");
    expect(m.api).toBe("zhipu-images");
    expect(m.output).toContain("image");
  });
});

describe("resolveZhipuImageModel", () => {
  it("returns ImagesModel literal for known model", () => {
    const model = resolveZhipuImageModel("glm-image");
    expect(model.id).toBe("glm-image");
    expect(model.api).toBe("zhipu-images");
    expect(model.provider).toBe("zhipu");
    expect(model.output).toContain("image");
  });

  it("includes baseUrl and cost", () => {
    const model = resolveZhipuImageModel("glm-image");
    expect(typeof model.baseUrl).toBe("string");
    expect(model.cost).toBeDefined();
  });

  it("throws for unknown model", () => {
    expect(() => resolveZhipuImageModel("nonexistent")).toThrow();
  });
});

describe("generateImagesZhipu", () => {
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

    const result = await generateImagesZhipu(SAMPLE_MODEL as any, baseContext as any, {
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
    expect(body.model).toBe("glm-image");
    expect(body.prompt).toBe("一只猫");
    expect((init as any).headers.Authorization).toBe("Bearer test-key");
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

    const result = await generateImagesZhipu(SAMPLE_MODEL as any, baseContext as any, {
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

    const result = await generateImagesZhipu(SAMPLE_MODEL as any, baseContext as any, {
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

    const result = await generateImagesZhipu(SAMPLE_MODEL as any, baseContext as any, {
      apiKey: "test-key",
    });

    expect(result.stopReason).toBe("error");
    expect(result.errorMessage).toBeTruthy();
  });

  it("returns stopReason error when apiKey is missing", async () => {
    const result = await generateImagesZhipu(SAMPLE_MODEL as any, baseContext as any, {});
    expect(result.stopReason).toBe("error");
    expect(result.errorMessage).toContain("api");
  });

  it("returns stopReason aborted when signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const result = await generateImagesZhipu(SAMPLE_MODEL as any, baseContext as any, {
      apiKey: "test-key",
      signal: controller.signal,
    });
    expect(result.stopReason).toBe("aborted");
  });

  it("includes size in request body when provided", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ data: [{ b64_json: "x" }] }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await generateImagesZhipu(SAMPLE_MODEL as any, baseContext as any, {
      apiKey: "k",
      size: "1024x1024",
    });

    const body = JSON.parse((fetchMock.mock.calls[0][1] as any).body);
    expect(body.size).toBe("1024x1024");
  });

  it("omits size when not provided", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ data: [{ b64_json: "x" }] }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await generateImagesZhipu(SAMPLE_MODEL as any, baseContext as any, { apiKey: "k" });

    const body = JSON.parse((fetchMock.mock.calls[0][1] as any).body);
    expect(body.size).toBeUndefined();
  });
});

describe("createZhipuImagesProvider", () => {
  it("returns provider with correct id and generateImages function", () => {
    const provider = createZhipuImagesProvider();
    expect(provider.id).toBe("zhipu");
    expect(provider.name).toBe("智谱");
    expect(typeof provider.generateImages).toBe("function");
    expect(provider.getModels().length).toBeGreaterThan(0);
  });
});
