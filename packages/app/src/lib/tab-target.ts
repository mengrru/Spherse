export type TabTarget =
  | { kind: "chat"; sessionId: string }
  | { kind: "file"; path: string }
  | { kind: "browser"; url: string };

function normalizeFilePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^(\.\/)+/, "");
}

function normalizeBrowserUrl(url: string): string {
  try {
    return new URL(url).href;
  } catch {
    return url;
  }
}

export function normalizeTabTarget(target: TabTarget): TabTarget {
  switch (target.kind) {
    case "chat":
      return target;
    case "file":
      return { kind: "file", path: normalizeFilePath(target.path) };
    case "browser":
      return { kind: "browser", url: normalizeBrowserUrl(target.url) };
  }
}

export function tabKey(target: TabTarget): string {
  const normalized = normalizeTabTarget(target);
  switch (normalized.kind) {
    case "chat":
      return `chat:${normalized.sessionId}`;
    case "file":
      return `file:${normalized.path}`;
    case "browser":
      return `browser:${normalized.url}`;
  }
}

export function projectHomeUrl(projectId: string): string {
  return `/project/${projectId}`;
}

export function tabUrl(projectId: string, target: TabTarget): string {
  const normalized = normalizeTabTarget(target);
  switch (normalized.kind) {
    case "chat":
      return `/project/${projectId}/chat/${normalized.sessionId}`;
    case "file":
      return `/project/${projectId}/content?path=${encodeURIComponent(normalized.path)}`;
    case "browser":
      return `/project/${projectId}/browser?url=${encodeURIComponent(normalized.url)}`;
  }
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

export function isTabTarget(value: unknown): value is TabTarget {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  switch (v.kind) {
    case "chat":
      return nonEmptyString(v.sessionId);
    case "file":
      return nonEmptyString(v.path);
    case "browser":
      return nonEmptyString(v.url);
    default:
      return false;
  }
}

function pathSegments(path: string): string[] {
  return normalizeFilePath(path).split("/").filter((seg) => seg !== "" && seg !== ".");
}

export function isPathAtOrUnder(path: string, parent: string): boolean {
  const child = pathSegments(path);
  const dir = pathSegments(parent);
  if (dir.length === 0 || dir.length > child.length) return false;
  return dir.every((seg, i) => child[i] === seg);
}

export function pickNeighborKey(keys: readonly string[], closingKey: string): string | null {
  const index = keys.indexOf(closingKey);
  if (index < 0) return null;
  return keys[index + 1] ?? keys[index - 1] ?? null;
}
