import path from "node:path";
import { categorizePath } from "./path-category.js";

export function normalizeProjectRelativePath(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) {
    return null;
  }
  if (path.isAbsolute(trimmed) || path.win32.isAbsolute(trimmed)) {
    return null;
  }

  const normalized = path.posix.normalize(trimmed.replace(/\\/g, "/")).replace(/\/+$/, "");
  if (!normalized || normalized === "." || normalized === ".." || normalized.startsWith("../")) {
    return null;
  }

  return normalized;
}

export function isReservedDenyPath(relativePath: string): boolean {
  return categorizePath(relativePath) !== "userFiles";
}

export function normalizeDeniedPath(input: string): string | null {
  const normalized = normalizeProjectRelativePath(input);
  if (!normalized || isReservedDenyPath(normalized)) {
    return null;
  }
  return normalized;
}

export function normalizeDeniedPaths(inputs: readonly string[]): string[] {
  const seen = new Set<string>();
  const deniedPaths: string[] = [];

  for (const input of inputs) {
    const normalized = normalizeDeniedPath(input);
    if (!normalized || seen.has(normalized)) {
      continue;
    }

    seen.add(normalized);
    deniedPaths.push(normalized);
  }

  return deniedPaths;
}
