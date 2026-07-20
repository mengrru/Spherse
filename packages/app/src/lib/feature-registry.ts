import type { HostKind } from "./host-bridge";

export type FeatureName =
  | "settings"
  | "agent-dialog"
  | "agent-trigger"
  | "floating-chat"
  | "text-selection-session"
  | "open-project";

const ELECTRON_ONLY: ReadonlySet<HostKind> = new Set(["electron"]);

export const FEATURE_HOST_MATRIX: Record<FeatureName, ReadonlySet<HostKind>> = {
  settings: ELECTRON_ONLY,
  "agent-dialog": ELECTRON_ONLY,
  "agent-trigger": ELECTRON_ONLY,
  "floating-chat": ELECTRON_ONLY,
  "text-selection-session": ELECTRON_ONLY,
  "open-project": ELECTRON_ONLY,
};

export function isFeatureEnabled(feature: FeatureName, kind: HostKind): boolean {
  return FEATURE_HOST_MATRIX[feature].has(kind);
}
