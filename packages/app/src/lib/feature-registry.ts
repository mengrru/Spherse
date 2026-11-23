import type { HostKind } from "./host-bridge";

export type FeatureName =
  | "settings"
  | "agent-dialog"
  | "agent-trigger"
  | "agent-mcp"
  | "agent-memory"
  | "floating-chat"
  | "floating-content-browser"
  | "content-split-pane"
  | "browser"
  | "text-selection-session"
  | "open-project"
  | "open-project-folder"
  | "project-marketplace";

const ELECTRON_ONLY: ReadonlySet<HostKind> = new Set(["electron"]);
const DESKTOP_LIKE: ReadonlySet<HostKind> = new Set(["electron", "browser"]);
const ALL_HOSTS: ReadonlySet<HostKind> = new Set(["electron", "web", "browser"]);

export const FEATURE_HOST_MATRIX: Record<FeatureName, ReadonlySet<HostKind>> = {
  settings: ALL_HOSTS,
  "agent-dialog": ALL_HOSTS,
  "agent-trigger": ALL_HOSTS,
  "agent-mcp": ALL_HOSTS,
  "agent-memory": ALL_HOSTS,
  "floating-chat": DESKTOP_LIKE,
  "floating-content-browser": DESKTOP_LIKE,
  "content-split-pane": DESKTOP_LIKE,
  browser: ELECTRON_ONLY,
  "text-selection-session": DESKTOP_LIKE,
  "open-project": DESKTOP_LIKE,
  "open-project-folder": ELECTRON_ONLY,
  "project-marketplace": new Set<HostKind>(["electron"]),
};

export function isFeatureEnabled(feature: FeatureName, kind: HostKind): boolean {
  return FEATURE_HOST_MATRIX[feature].has(kind);
}
