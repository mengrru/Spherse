export const FLOAT_MIN_WIDTH = 320;
export const FLOAT_MIN_HEIGHT = 400;
export const FLOAT_MARGIN = 20;

export function getDefaultPosition(width: number, height: number, offset = 0): { x: number; y: number } {
  return {
    x: Math.max(FLOAT_MARGIN, window.innerWidth - width - FLOAT_MARGIN - offset),
    y: Math.max(FLOAT_MARGIN, window.innerHeight - height - FLOAT_MARGIN - offset),
  };
}
