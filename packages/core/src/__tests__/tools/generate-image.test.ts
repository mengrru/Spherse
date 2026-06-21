import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createGenerateImageTool } from "../../tools/generate-image.js";
import { createTempProject, cleanupDir, pathExists } from "../helpers.js";
import fs from "node:fs/promises";
import path from "node:path";

vi.mock("@earendil-works/pi-ai", () => ({
  generateImages: vi.fn(),
  getImageModel: vi.fn(),
  registerImagesApiProvider: vi.fn(),
}));

const MOCK_B64 = "iVBORw0KGgo=";

function mockAssistantImages() {
  return {
    api: "openrouter-images",
    provider: "openrouter",
    model: "test-model",
    output: [{ type: "image", data: MOCK_B64, mimeType: "image/png" }],
    stopReason: "stop" as const,
    timestamp: Date.now(),
  };
}

describe("createGenerateImageTool", () => {
  let projectRoot: string;
  let generateImagesMock: ReturnType<typeof vi.fn>;
  let getImageModelMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    projectRoot = await createTempProject();
    const piAi = await import("@earendil-works/pi-ai");
    generateImagesMock = piAi.generateImages as any;
    getImageModelMock = piAi.getImageModel as any;
    generateImagesMock.mockClear();
    getImageModelMock.mockClear();
    generateImagesMock.mockResolvedValue(mockAssistantImages());
    getImageModelMock.mockReturnValue({ id: "test-model", api: "openrouter-images" });
    process.env.SPHERSE_IMAGE_MODEL = "openrouter/google/test-image";
    process.env.SPHERSE_IMAGE_API_KEY = "test-key";
  });

  afterEach(async () => {
    await cleanupDir(projectRoot);
    vi.restoreAllMocks();
    delete process.env.SPHERSE_IMAGE_MODEL;
    delete process.env.SPHERSE_IMAGE_API_KEY;
  });

  it("writes image to .spherse/generated-images/ and returns done details", async () => {
    const tool = createGenerateImageTool(projectRoot);
    const onUpdate = vi.fn();

    const result = await tool.execute("tc1", { prompt: "一只猫" }, undefined as any, onUpdate);

    expect(result.details).toMatchObject({
      type: "image",
      status: "done",
      prompt: "一只猫",
      mimeType: "image/png",
    });
    const details = result.details as any;
    expect(details.path).toMatch(/^\.spherse\/generated-images\//);

    const abs = path.join(projectRoot, details.path);
    expect(pathExists(projectRoot, details.path)).toBe(true);
    const written = await fs.readFile(abs);
    expect(written.equals(Buffer.from(MOCK_B64, "base64"))).toBe(true);
  });

  it("calls onUpdate twice: generating placeholder before generateImages, then done", async () => {
    const tool = createGenerateImageTool(projectRoot);
    const onUpdate = vi.fn();

    await tool.execute("tc1", { prompt: "test" }, undefined as any, onUpdate);

    expect(onUpdate).toHaveBeenCalledTimes(2);
    expect(onUpdate.mock.calls[0][0].details).toMatchObject({ type: "image", status: "generating" });
    expect(onUpdate.mock.calls[1][0].details).toMatchObject({ type: "image", status: "done" });

    expect(generateImagesMock).toHaveBeenCalled();
  });

  it("generates filename matching yyyyMMddHHmmss-UTC + 4 hex", async () => {
    const tool = createGenerateImageTool(projectRoot);
    const result = await tool.execute("tc1", { prompt: "x" }, undefined as any, undefined as any);
    const filename = path.basename((result.details as any).path);
    expect(filename).toMatch(/^\d{14}-[0-9a-f]{4}\.png$/);
  });

  it("returns error content without calling generateImages when env missing", async () => {
    delete process.env.SPHERSE_IMAGE_MODEL;
    const tool = createGenerateImageTool(projectRoot);
    const onUpdate = vi.fn();

    const result = await tool.execute("tc1", { prompt: "x" }, undefined as any, onUpdate);

    expect(result.content[0].text).toContain("配置");
    expect(generateImagesMock).not.toHaveBeenCalled();
    expect(onUpdate).not.toHaveBeenCalled();
  });

  it("returns error when key for active provider missing", async () => {
    delete process.env.SPHERSE_IMAGE_API_KEY;
    const tool = createGenerateImageTool(projectRoot);
    const result = await tool.execute("tc1", { prompt: "x" }, undefined as any, undefined as any);
    expect(result.content[0].text).toContain("配置");
  });

  it("returns error when generateImages stopReason is error", async () => {
    generateImagesMock.mockResolvedValue({
      ...mockAssistantImages(),
      stopReason: "error",
      errorMessage: "upstream failed",
      output: [],
    });
    const tool = createGenerateImageTool(projectRoot);
    const onUpdate = vi.fn();

    const result = await tool.execute("tc1", { prompt: "x" }, undefined as any, onUpdate);

    expect(result.content[0].text).toContain("失败");
    expect(onUpdate.mock.calls[1][0].details).toMatchObject({ type: "image", status: "error" });
  });

  it("returns error when output has no image content", async () => {
    generateImagesMock.mockResolvedValue({
      ...mockAssistantImages(),
      output: [{ type: "text", text: "no image" }],
    });
    const tool = createGenerateImageTool(projectRoot);
    const result = await tool.execute("tc1", { prompt: "x" }, undefined as any, undefined as any);
    expect(result.content[0].text).toContain("失败");
  });

  it("uses zhipu path when provider is zhipu", async () => {
    process.env.SPHERSE_IMAGE_MODEL = "zhipu/glm-image";
    process.env.SPHERSE_IMAGE_API_KEY = "zhipu-key";
    generateImagesMock.mockResolvedValue({
      ...mockAssistantImages(),
      api: "zhipu-images",
      provider: "zhipu",
      model: "glm-image",
    });

    const tool = createGenerateImageTool(projectRoot);
    await tool.execute("tc1", { prompt: "x" }, undefined as any, undefined as any);

    const passedModel = generateImagesMock.mock.calls[0][0];
    expect(passedModel.api).toBe("zhipu-images");
    expect(passedModel.provider).toBe("zhipu");
  });
});
