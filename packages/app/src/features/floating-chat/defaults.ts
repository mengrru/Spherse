import type { FloatingChatState } from "./store";

export const FLOAT_DEFAULT_WIDTH = 420;
export const FLOAT_DEFAULT_HEIGHT = 600;
export const FLOAT_MIN_WIDTH = 320;
export const FLOAT_MIN_HEIGHT = 400;
export const FLOAT_MARGIN = 20;

export function getDefaultFloatingState(sessionId: string): FloatingChatState {
  return {
    sessionId,
    position: {
      x: window.innerWidth - FLOAT_DEFAULT_WIDTH - FLOAT_MARGIN,
      y: window.innerHeight - FLOAT_DEFAULT_HEIGHT - FLOAT_MARGIN,
    },
    size: {
      width: FLOAT_DEFAULT_WIDTH,
      height: FLOAT_DEFAULT_HEIGHT,
    },
  };
}
