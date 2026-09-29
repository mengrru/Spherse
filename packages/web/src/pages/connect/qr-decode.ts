import jsQR from "jsqr";

export const SCAN_FALLBACK_INTERVAL_MS = 300;
export const VIDEO_MAX_DIM = 960;

export interface QrDetector {
  detect: (source: CanvasImageSource) => Promise<Array<{ rawValue: string }>>;
}

export type FrameCallbackVideo = HTMLVideoElement & {
  requestVideoFrameCallback?: (callback: () => void) => number;
  cancelVideoFrameCallback?: (handle: number) => void;
};

let cachedDetector: QrDetector | null | undefined;

export function getQrDetector(): QrDetector | null {
  if (cachedDetector === undefined) {
    const Ctor = (window as unknown as {
      BarcodeDetector?: new (opts: { formats: string[] }) => QrDetector;
    }).BarcodeDetector;
    if (typeof Ctor === "function") {
      try {
        cachedDetector = new Ctor({ formats: ["qr_code"] });
      } catch {
        cachedDetector = null;
      }
    } else {
      cachedDetector = null;
    }
  }
  return cachedDetector;
}

export function drawScaled(
  source: CanvasImageSource,
  sourceWidth: number,
  sourceHeight: number,
  maxDim: number,
  reuse?: HTMLCanvasElement,
): { canvas: HTMLCanvasElement; imageData: ImageData } | null {
  const canvas = reuse ?? document.createElement("canvas");
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  const scale = Math.min(1, maxDim / Math.max(sourceWidth, sourceHeight));
  canvas.width = Math.max(1, Math.round(sourceWidth * scale));
  canvas.height = Math.max(1, Math.round(sourceHeight * scale));
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  return { canvas, imageData };
}

export function jsQrFromImageData(imageData: ImageData): string | null {
  const decoded = jsQR(imageData.data, imageData.width, imageData.height, {
    inversionAttempts: "attemptBoth",
  });
  return decoded?.data ?? null;
}

export async function detectWithDetector(detector: QrDetector, source: CanvasImageSource): Promise<string | null> {
  try {
    const results = await detector.detect(source);
    const raw = results.find((r) => typeof r.rawValue === "string" && r.rawValue);
    return raw?.rawValue ?? null;
  } catch {
    return null;
  }
}

export async function decodeImageFile(file: File): Promise<string | null> {
  const bitmap = await createImageBitmap(file);
  try {
    const detector = getQrDetector();
    const attempts = [VIDEO_MAX_DIM, Math.max(bitmap.width, bitmap.height)];
    for (const maxDim of attempts) {
      const drawn = drawScaled(bitmap, bitmap.width, bitmap.height, maxDim);
      if (!drawn) break;
      if (detector) {
        const payload = await detectWithDetector(detector, drawn.canvas);
        if (payload) return payload;
      }
      const decoded = jsQrFromImageData(drawn.imageData);
      if (decoded) return decoded;
    }
    return null;
  } finally {
    bitmap.close();
  }
}
