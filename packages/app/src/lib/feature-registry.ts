import type { HostKind } from "./host-bridge";

export type FeatureName =
  | "settings"
  | "agent-dialog"
  | "agent-trigger"
  | "agent-mcp"
  | "floating-chat"
  | "floating-content-browser"
  | "browser"
  | "text-selection-session"
  | "open-project";

const ELECTRON_ONLY: ReadonlySet<HostKind> = new Set(["electron"]);
const ALL_HOSTS: ReadonlySet<HostKind> = new Set(["electron", "web"]);

export const FEATURE_HOST_MATRIX: Record<FeatureName, ReadonlySet<HostKind>> = {
  settings: ELECTRON_ONLY,
  "agent-dialog": ALL_HOSTS,
  "agent-trigger": ALL_HOSTS,
  "agent-mcp": ALL_HOSTS,
  "floating-chat": ELECTRON_ONLY,
  "floating-content-browser": ELECTRON_ONLY,
  browser: ELECTRON_ONLY,
  "text-selection-session": ELECTRON_ONLY,
  "open-project": ELECTRON_ONLY,
};

export function isFeatureEnabled(feature: FeatureName, kind: HostKind): boolean {
  return FEATURE_HOST_MATRIX[feature].has(kind);
}
