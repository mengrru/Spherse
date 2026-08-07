import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  compressImage,
  MAX_BYTES,
  MAX_EDGE,
  QUALITY,
  QUALITY_FLOOR,
} from "./compress-image";

function makeBlob(size: number): Blob {
  return new Blob([new Uint8Array(size)]);
}

interface FakeCtx {
  drawImage: ReturnType<typeof vi.fn>;
}

interface FakeCanvas {
  width: number;
  height: number;
  getContext(): FakeCtx;
  convertToBlob: ReturnType<typeof vi.fn>;
}

function setupCanvas(convert: (quality: number) => Blob): {
  fakeCanvas: FakeCanvas;
  drawImage: ReturnType<typeof vi.fn>;
  convertToBlob: ReturnType<typeof vi.fn>;
} {
  const drawImage = vi.fn();
  const convertToBlob = vi.fn(async ({ quality }: { type?: string; quality?: number }) =>
    convert(quality ?? QUALITY),
  );
  class FakeCanvasImpl {
    width: number;
    height: number;
    constructor(width: number, height: number) {
      this.width = width;
      this.height = height;
    }
    getContext() {
      return { drawImage };
    }
    convertToBlob = convertToBlob;
  }
  const fakeCanvas = new FakeCanvasImpl(0, 0) as unknown as FakeCanvas;
  vi.stubGlobal("OffscreenCanvas", FakeCanvasImpl);
  return { fakeCanvas, drawImage, convertToBlob };
}

function stubBitmap(width: number, height: number): { width: number; height: number; close: ReturnType<typeof vi.fn> } {
  const bitmap = { width, height, close: vi.fn() };
  vi.stubGlobal("createImageBitmap", vi.fn(async () => bitmap));
  return bitmap;
}

function imageFile(): File {
  return new File([new Uint8Array(4)], "photo.png", { type: "image/png" });
}

describe("compressImage", () => {
  beforeEach(() => {
    vi.stubGlobal("createImageBitmap", undefined);
    vi.stubGlobal("OffscreenCanvas", undefined);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("scales down so the long edge does not exceed MAX_EDGE", async () => {
    stubBitmap(3000, 2000);
    const { drawImage } = setupCanvas(() => makeBlob(100));

    const result = await compressImage(imageFile());

    expect(Math.max(result.width, result.height)).toBe(MAX_EDGE);
    expect(result.width).toBe(MAX_EDGE);
    expect(result.height).toBe(Math.round(2000 * (MAX_EDGE / 3000)));
    expect(drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0, result.width, result.height);
  });

  it("keeps original dimensions when already within the edge limit", async () => {
    stubBitmap(800, 600);
    setupCanvas(() => makeBlob(100));

    const result = await compressImage(imageFile());

    expect(result.width).toBe(800);
    expect(result.height).toBe(600);
  });

  it("always encodes to image/jpeg at the starting quality first", async () => {
    stubBitmap(100, 100);
    const { convertToBlob } = setupCanvas(() => makeBlob(100));

    const result = await compressImage(imageFile());

    expect(result.mimeType).toBe("image/jpeg");
    expect(convertToBlob).toHaveBeenCalledTimes(1);
    expect(convertToBlob).toHaveBeenLastCalledWith({ type: "image/jpeg", quality: QUALITY });
  });

  it("reduces quality until the blob fits under MAX_BYTES", async () => {
    stubBitmap(100, 100);
    const { convertToBlob } = setupCanvas((q) =>
      q > 0.65 ? makeBlob(MAX_BYTES + 1000) : makeBlob(100),
    );

    const result = await compressImage(imageFile());

    expect(result.blob.size).toBeLessThanOrEqual(MAX_BYTES);
    expect(convertToBlob).toHaveBeenCalledTimes(3);
    const qualities = convertToBlob.mock.calls.map((c) => (c[0] as { quality: number }).quality);
    expect(qualities).toEqual([QUALITY, 0.7, 0.6]);
  });

  it("stops at the quality floor even when the blob stays too large", async () => {
    stubBitmap(100, 100);
    const { convertToBlob } = setupCanvas(() => makeBlob(MAX_BYTES + 1000));

    const result = await compressImage(imageFile());

    expect(convertToBlob).toHaveBeenCalledTimes(4);
    const qualities = convertToBlob.mock.calls.map((c) => (c[0] as { quality: number }).quality);
    expect(qualities[qualities.length - 1]).toBe(QUALITY_FLOOR);
    expect(result.blob.size).toBeGreaterThan(MAX_BYTES);
  });

  it("throws when the image cannot be decoded", async () => {
    vi.stubGlobal("createImageBitmap", vi.fn(async () => {
      throw new Error("decode failed");
    }));

    await expect(compressImage(imageFile())).rejects.toThrow(/decode|image/i);
  });
});
