export const MAX_EDGE = 1568;
export const MAX_BYTES = 1_000_000;
export const QUALITY = 0.82;
export const QUALITY_FLOOR = 0.5;

const QUALITY_STEPS = [QUALITY, 0.7, 0.6, QUALITY_FLOOR];

export interface CompressedImage {
  blob: Blob;
  width: number;
  height: number;
  mimeType: "image/jpeg";
}

export async function compressImage(file: File): Promise<CompressedImage> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error("Failed to decode image");
  }

  const sourceWidth = bitmap.width;
  const sourceHeight = bitmap.height;
  const longEdge = Math.max(sourceWidth, sourceHeight);
  const scale = longEdge > MAX_EDGE ? MAX_EDGE / longEdge : 1;
  const targetWidth = Math.round(sourceWidth * scale);
  const targetHeight = Math.round(sourceHeight * scale);

  const canvas = new OffscreenCanvas(targetWidth, targetHeight);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Failed to acquire canvas 2d context");
  ctx.drawImage(bitmap, 0, 0, targetWidth, targetHeight);
  bitmap.close?.();

  let blob = await canvas.convertToBlob({ type: "image/jpeg", quality: QUALITY_STEPS[0] });
  let stepIndex = 0;
  while (blob.size > MAX_BYTES && stepIndex < QUALITY_STEPS.length - 1) {
    stepIndex += 1;
    blob = await canvas.convertToBlob({ type: "image/jpeg", quality: QUALITY_STEPS[stepIndex] });
  }

  return { blob, width: targetWidth, height: targetHeight, mimeType: "image/jpeg" };
}
