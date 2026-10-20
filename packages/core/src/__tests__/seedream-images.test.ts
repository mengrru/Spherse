import { describe, it, expect } from "vitest";
import {
  resolveSeedreamImageModel,
  normalizeSeedreamSize,
  SEEDREAM_IMAGE_MODELS,
  createSeedreamImagesProvider,
} from "../model-providers/seedream-images.js";

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

describe("normalizeSeedreamSize", () => {
  it("returns undefined for auto regardless of case and surrounding whitespace", () => {
    expect(normalizeSeedreamSize("auto")).toBeUndefined();
    expect(normalizeSeedreamSize("AUTO")).toBeUndefined();
    expect(normalizeSeedreamSize("  Auto ")).toBeUndefined();
  });

  it("returns undefined for undefined and empty input", () => {
    expect(normalizeSeedreamSize(undefined)).toBeUndefined();
    expect(normalizeSeedreamSize("")).toBeUndefined();
    expect(normalizeSeedreamSize("   ")).toBeUndefined();
  });

  it("passes through tier and explicit pixel sizes after trimming", () => {
    expect(normalizeSeedreamSize("2K")).toBe("2K");
    expect(normalizeSeedreamSize(" 2048x1024 ")).toBe("2048x1024");
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
