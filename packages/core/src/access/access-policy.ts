import { categorizePath, type PathCategory } from "./path-category.js";
import { normalizeProjectRelativePath } from "./denied-paths.js";
import { resolveProjectPath } from "../utils/path-safety.js";
import { AccessDeniedError } from "../errors.js";

export type Decision = { allowed: true } | { allowed: false; reason: string };

export interface AccessPolicy {
  assertRead(relativePath: string): void;
  assertWrite(relativePath: string): void;
  canRead(relativePath: string): boolean;
  canWrite(relativePath: string): boolean;
}

const LLM_READ: ReadonlySet<PathCategory> = new Set<PathCategory>([
  "userFiles",
  "rootIndex",
  "changelog",
  "projectConfig",
  "projectTheme",
  "generatedImages",
  "skills",
  "agentProfile",
  "agentTheme",
  "agentSchedules",
  "agentScheduleLogs",
]);

const LLM_WRITE: ReadonlySet<PathCategory> = new Set<PathCategory>([
  "userFiles",
  "projectTheme",
  "agentTheme",
]);

const SRV_READ: ReadonlySet<PathCategory> = new Set<PathCategory>([
  "userFiles",
  "rootIndex",
  "changelog",
  "projectTheme",
  "generatedImages",
  "skills",
  "agentTheme",
]);

const SRV_WRITE: ReadonlySet<PathCategory> = new Set<PathCategory>([
  "userFiles",
  "rootIndex",
  "changelog",
  "projectTheme",
  "skills",
]);

function assertAllowed(
  projectRootPath: string,
  allowed: ReadonlySet<PathCategory>,
  deniedPaths: readonly string[],
  relativePath: string,
  action: "read" | "write",
): void {
  resolveProjectPath(projectRootPath, relativePath);

  const normalized = normalizeProjectRelativePath(relativePath);
  if (normalized !== null) {
    for (const denied of deniedPaths) {
      if (normalized === denied || normalized.startsWith(`${denied}/`)) {
        throw new AccessDeniedError(
          `Access denied: ${action} of "${relativePath}" is blocked by denied path "${denied}"`,
        );
      }
    }
  }

  const category = categorizePath(relativePath);
  if (!allowed.has(category)) {
    throw new AccessDeniedError(
      `Access denied: ${action} of "${relativePath}" (category "${category}") is not permitted`,
    );
  }
}

function createPolicy(
  projectRootPath: string,
  readSet: ReadonlySet<PathCategory>,
  writeSet: ReadonlySet<PathCategory>,
  deniedPaths: readonly string[],
): AccessPolicy {
  const check = (
    set: ReadonlySet<PathCategory>,
    relativePath: string,
    action: "read" | "write",
  ): boolean => {
    try {
      assertAllowed(projectRootPath, set, deniedPaths, relativePath, action);
      return true;
    } catch (e) {
      if (e instanceof AccessDeniedError) return false;
      throw e;
    }
  };

  return {
    assertRead: (rel) => assertAllowed(projectRootPath, readSet, deniedPaths, rel, "read"),
    assertWrite: (rel) => assertAllowed(projectRootPath, writeSet, deniedPaths, rel, "write"),
    canRead: (rel) => check(readSet, rel, "read"),
    canWrite: (rel) => check(writeSet, rel, "write"),
  };
}

export function llmAccessPolicy(
  projectRootPath: string,
  aiDeniedPaths: readonly string[],
): AccessPolicy {
  return createPolicy(projectRootPath, LLM_READ, LLM_WRITE, aiDeniedPaths);
}

export function serverAccessPolicy(projectRootPath: string): AccessPolicy {
  return createPolicy(projectRootPath, SRV_READ, SRV_WRITE, []);
}
