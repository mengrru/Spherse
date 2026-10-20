import { describe, it, expect, vi, afterEach } from "vitest";
import {
  resolveSeedreamImageModel,
  generateImagesSeedream,
  SEEDREAM_IMAGE_MODELS,
  createSeedreamImagesProvider,
} from "../model-providers/seedream-images.js";

const SAMPLE_MODEL = {
  id: "doubao-seedream-4-5-251128",
  name: "Seedream 4.5",
  type: "image" as const,
  api: "seedream-images",
  provider: "seedream",
  baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
  input: ["text"],
  output: ["image"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
} as const;

describe("SEEDREAM_IMAGE_MODELS", () => {
  it("contains all expected ark model ids with correct shape", () => {
    const expectedIds = [
      "doubao-seedream-5-0-pro-260628",
      "doubao-seedream-5-0-flash-260915",
      "doubao-seedream-5-0-260128",
      "doubao-seedream-4-5-251128",
      "doubao-seedream-4-0-250828",
    ];
    expect(Object.keys(SEEDREAM_IMAGE_MODELS).sort()).toEqual(expectedIds.sort());
    for (const m of Object.values(SEEDREAM_IMAGE_MODELS)) {
      expect(m.provider).toBe("seedream");
      expect(m.api).toBe("seedream-images");
      expect(m.baseUrl).toBe("https://ark.cn-beijing.volces.com/api/v3");
      expect(m.output).toContain("image");
      expect(m.input).toEqual(["text"]);
    }
  });
});

describe("resolveSeedreamImageModel", () => {
  it("returns ImagesModel literal for known model", () => {
    const model = resolveSeedreamImageModel("doubao-seedream-4-5-251128");
    expect(model.id).toBe("doubao-seedream-4-5-251128");
    expect(model.api).toBe("seedream-images");
    expect(model.provider).toBe("seedream");
    expect(model.output).toContain("image");
  });

  it("includes baseUrl and cost", () => {
    const model = resolveSeedreamImageModel("doubao-seedream-4-5-251128");
    expect(typeof model.baseUrl).toBe("string");
    expect(model.cost).toBeDefined();
  });

  it("throws for unknown model", () => {
    expect(() => resolveSeedreamImageModel("nonexistent")).toThrow();
  });
});

describe("generateImagesSeedream", () => {
  const baseContext = {
    input: [{ type: "text" as const, text: "一只猫" }],
  };

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("normalizes b64_json response to ImageContent with ark endpoint and bearer auth", async () => {
    const b64 = "aGVsbG8=";
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        data: [{ b64_json: b64, size: "2048x2048" }],
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await generateImagesSeedream(SAMPLE_MODEL as any, baseContext as any, {
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
    expect(url).toBe("https://ark.cn-beijing.volces.com/api/v3/images/generations");
    const body = JSON.parse((init as any).body);
    expect(body.model).toBe("doubao-seedream-4-5-251128");
    expect(body.prompt).toBe("一只猫");
    expect(body.response_format).toBe("b64_json");
    expect((init as any).headers.Authorization).toBe("Bearer test-key");
  });

  it("maps output_format to mimeType and defaults to jpeg", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        data: [{ b64_json: "aGk=", output_format: "png" }, { b64_json: "oa==" }],
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await generateImagesSeedream(SAMPLE_MODEL as any, baseContext as any, {
      apiKey: "test-key",
    });

    expect(result.stopReason).toBe("stop");
    expect(result.output).toHaveLength(2);
    if (result.output[0].type === "image" && result.output[1].type === "image") {
      expect(result.output[0].mimeType).toBe("image/png");
      expect(result.output[1].mimeType).toBe("image/jpeg");
    }
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

    const result = await generateImagesSeedream(SAMPLE_MODEL as any, baseContext as any, {
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

  it("returns stopReason error on non-200 response with ark error message", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        json: async () => ({
          error: { code: "AuthenticationError", message: "Invalid API key provided" },
        }),
      }),
    );

    const result = await generateImagesSeedream(SAMPLE_MODEL as any, baseContext as any, {
      apiKey: "bad-key",
    });

    expect(result.stopReason).toBe("error");
    expect(result.errorMessage).toBe("Invalid API key provided");
    expect(result.output).toHaveLength(0);
  });

  it("falls back to status-based message when error body has no message", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 503,
        json: async () => ({}),
      }),
    );

    const result = await generateImagesSeedream(SAMPLE_MODEL as any, baseContext as any, {
      apiKey: "k",
    });

    expect(result.stopReason).toBe("error");
    expect(result.errorMessage).toBe("Seedream API error: 503");
  });

  it("returns stopReason error when a data item carries an error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          data: [{ b64_json: "", error: { code: "OutputImageSensitiveContentDetected", message: "sensitive" } }],
        }),
      }),
    );

    const result = await generateImagesSeedream(SAMPLE_MODEL as any, baseContext as any, {
      apiKey: "test-key",
    });

    expect(result.stopReason).toBe("error");
    expect(result.errorMessage).toBe("sensitive");
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

    const result = await generateImagesSeedream(SAMPLE_MODEL as any, baseContext as any, {
      apiKey: "test-key",
    });

    expect(result.stopReason).toBe("error");
    expect(result.errorMessage).toBeTruthy();
  });

  it("returns stopReason error when apiKey is missing", async () => {
    const result = await generateImagesSeedream(SAMPLE_MODEL as any, baseContext as any, {});
    expect(result.stopReason).toBe("error");
    expect(result.errorMessage).toBe("No Seedream api key provided");
  });

  it("returns stopReason error when fetch rejects with network error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValueOnce(new Error("network down")),
    );

    const result = await generateImagesSeedream(SAMPLE_MODEL as any, baseContext as any, {
      apiKey: "test-key",
    });

    expect(result.stopReason).toBe("error");
    expect(result.errorMessage).toBe("network down");
  });

  it("returns stopReason aborted when fetch rejects with AbortError", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValueOnce(Object.assign(new Error(), { name: "AbortError" })),
    );

    const result = await generateImagesSeedream(SAMPLE_MODEL as any, baseContext as any, {
      apiKey: "test-key",
    });

    expect(result.stopReason).toBe("aborted");
  });

  it("returns stopReason error with code fallback when data item error lacks message", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          data: [{ error: { code: "OutputImageSensitiveContentDetected" } }],
        }),
      }),
    );

    const result = await generateImagesSeedream(SAMPLE_MODEL as any, baseContext as any, {
      apiKey: "test-key",
    });

    expect(result.stopReason).toBe("error");
    expect(result.errorMessage).toBe("OutputImageSensitiveContentDetected");
  });

  it("returns stopReason aborted when signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const result = await generateImagesSeedream(SAMPLE_MODEL as any, baseContext as any, {
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

    await generateImagesSeedream(SAMPLE_MODEL as any, baseContext as any, {
      apiKey: "k",
      size: "2K",
    });

    const body = JSON.parse((fetchMock.mock.calls[0][1] as any).body);
    expect(body.size).toBe("2K");
  });

  it("omits size when not provided and ignores quality", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ data: [{ b64_json: "x" }] }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await generateImagesSeedream(SAMPLE_MODEL as any, baseContext as any, {
      apiKey: "k",
      quality: "high",
    });

    const body = JSON.parse((fetchMock.mock.calls[0][1] as any).body);
    expect(body.size).toBeUndefined();
    expect(body.quality).toBeUndefined();
  });
});

describe("createSeedreamImagesProvider", () => {
  it("returns provider with correct id, image models, and generateImages function", () => {
    const provider = createSeedreamImagesProvider();
    expect(provider.id).toBe("seedream");
    expect(provider.name).toBe("Seedream");
    expect(typeof provider.generateImages).toBe("function");
    const all = provider.getAllModels?.() ?? [];
    expect(all.length).toBe(5);
    expect(all.every((m) => (m as { type?: string }).type === "image")).toBe(true);
    expect(provider.getModels().length).toBe(0);
  });
});
