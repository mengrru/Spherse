export const SPLIT_DEFAULT_RATIO = 0.5;
export const SPLIT_MIN_MAIN_WIDTH = 400;
export const SPLIT_MIN_PANE_WIDTH = 320;
export const SPLIT_KEYBOARD_STEP = 0.05;

export function isValidRatio(ratio: unknown): ratio is number {
  return typeof ratio === "number" && Number.isFinite(ratio) && ratio > 0 && ratio < 1;
}

export function clampRatio(ratio: number, containerWidth: number): number {
  if (!Number.isFinite(containerWidth) || containerWidth <= 0) {
    return isValidRatio(ratio) ? ratio : SPLIT_DEFAULT_RATIO;
  }
  if (containerWidth < SPLIT_MIN_MAIN_WIDTH + SPLIT_MIN_PANE_WIDTH) return SPLIT_DEFAULT_RATIO;
  const min = SPLIT_MIN_PANE_WIDTH / containerWidth;
  const max = 1 - SPLIT_MIN_MAIN_WIDTH / containerWidth;
  const value = isValidRatio(ratio) ? ratio : SPLIT_DEFAULT_RATIO;
  return Math.min(max, Math.max(min, value));
}
