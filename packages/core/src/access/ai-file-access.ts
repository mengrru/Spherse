import path from "node:path";
import { AccessDeniedError } from "../errors.js";

export interface AiFileAccessPolicy {
  deniedPaths: readonly string[];
  isDenied(relativePath: string): boolean;
  assertReadableByAi(relativePath: string): void;
}

export function normalizeDeniedPath(input: string): string | null {
  const normalized = normalizeProjectRelativePath(input);
  if (!normalized || isReservedAiDenyPath(normalized)) {
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

export function isReservedAiDenyPath(relativePath: string): boolean {
  return (
    relativePath === "AGENTS.md" ||
    relativePath === "CHANGELOG.md" ||
    relativePath === ".spherse" ||
    relativePath.startsWith(".spherse/")
  );
}

export function createAiFileAccessPolicy(
  _projectRoot: string,
  deniedPaths: readonly string[],
): AiFileAccessPolicy {
  const normalizedDeniedPaths = normalizeDeniedPaths(deniedPaths);

  return {
    deniedPaths: normalizedDeniedPaths,
    isDenied(relativePath: string): boolean {
      const normalized = normalizeProjectRelativePath(relativePath);
      if (!normalized) {
        return true;
      }

      return normalizedDeniedPaths.some(
        (deniedPath) => normalized === deniedPath || normalized.startsWith(`${deniedPath}/`),
      );
    },
    assertReadableByAi(relativePath: string): void {
      const normalized = normalizeProjectRelativePath(relativePath) ?? relativePath;
      if (this.isDenied(relativePath)) {
        throw new AccessDeniedError(`Access denied by AI read settings: ${normalized}`);
      }
    },
  };
}

function normalizeProjectRelativePath(input: string): string | null {
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
