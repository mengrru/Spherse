export interface NavState {
  closeTab?: string;
  closedUrl?: string;
  replaceTab?: string;
  skipLeaveGuard?: boolean;
}

export function readNavState(state: unknown): NavState {
  if (!state || typeof state !== "object") return {};
  const s = state as Record<string, unknown>;
  const result: NavState = {};
  if (typeof s.closeTab === "string") result.closeTab = s.closeTab;
  if (typeof s.closedUrl === "string") result.closedUrl = s.closedUrl;
  if (typeof s.replaceTab === "string") result.replaceTab = s.replaceTab;
  if (s.skipLeaveGuard === true) result.skipLeaveGuard = true;
  return result;
}

export function hasTabNavState(state: NavState): boolean {
  return state.closeTab !== undefined || state.replaceTab !== undefined;
}
