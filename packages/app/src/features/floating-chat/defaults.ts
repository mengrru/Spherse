import { getDefaultPosition } from "../../components/floating-frame/defaults";
import type { FloatingChatState } from "./store";

export const FLOAT_DEFAULT_WIDTH = 420;
export const FLOAT_DEFAULT_HEIGHT = 600;
export { FLOAT_MIN_WIDTH, FLOAT_MIN_HEIGHT, FLOAT_MARGIN } from "../../components/floating-frame/defaults";

export function getDefaultFloatingState(sessionId: string): FloatingChatState {
  return {
    sessionId,
    position: getDefaultPosition(FLOAT_DEFAULT_WIDTH, FLOAT_DEFAULT_HEIGHT),
    size: {
      width: FLOAT_DEFAULT_WIDTH,
      height: FLOAT_DEFAULT_HEIGHT,
    },
  };
}
