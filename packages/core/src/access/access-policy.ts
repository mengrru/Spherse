import { categorizePath, ruleForPath, type PathCategory } from "./path-category.js";
import { normalizeProjectRelativePath } from "./denied-paths.js";
import { resolveProjectPath } from "../utils/path-safety.js";
import { AccessDeniedError } from "../errors.js";
import type { PathRule } from "../kernel/ports.js";

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
  "attachments",
  "skills",
  "agentsRoot",
  "agentProfile",
  "agentTheme",
  "agentSkills",
  "agentTriggers",
  "agentTriggerLogs",
  "spherseMetaDir",
  "spherseOther",
]);

const LLM_WRITE: ReadonlySet<PathCategory> = new Set<PathCategory>([
  "userFiles",
  "projectTheme",
  "skills",
  "agentTheme",
  "agentSkills",
]);

const SRV_READ: ReadonlySet<PathCategory> = new Set<PathCategory>([
  "userFiles",
  "rootIndex",
  "changelog",
  "projectTheme",
  "generatedImages",
  "attachments",
  "skills",
  "agentTheme",
  "agentSkills",
]);

const SRV_WRITE: ReadonlySet<PathCategory> = new Set<PathCategory>([
  "userFiles",
  "rootIndex",
  "changelog",
  "projectTheme",
  "attachments",
  "skills",
  "agentSkills",
]);

function assertAllowed(
  projectRootPath: string,
  allowed: ReadonlySet<PathCategory>,
  deniedPaths: readonly string[],
  relativePath: string,
  action: "read" | "write",
  extraRules?: ReadonlyArray<PathRule>,
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

  const matchedRule = ruleForPath(relativePath, extraRules);
  if (matchedRule) {
    const allowedByRule = action === "read" ? matchedRule.llm.read : matchedRule.llm.write;
    if (!allowedByRule) {
      throw new AccessDeniedError(
        `Access denied: ${action} of "${relativePath}" (category "${matchedRule.category}") is not permitted`,
      );
    }
    return;
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
  extraRules?: ReadonlyArray<PathRule>,
): AccessPolicy {
  const check = (
    set: ReadonlySet<PathCategory>,
    relativePath: string,
    action: "read" | "write",
  ): boolean => {
    try {
      assertAllowed(projectRootPath, set, deniedPaths, relativePath, action, extraRules);
      return true;
    } catch (e) {
      if (e instanceof AccessDeniedError) return false;
      throw e;
    }
  };

  return {
    assertRead: (rel) => assertAllowed(projectRootPath, readSet, deniedPaths, rel, "read", extraRules),
    assertWrite: (rel) => assertAllowed(projectRootPath, writeSet, deniedPaths, rel, "write", extraRules),
    canRead: (rel) => check(readSet, rel, "read"),
    canWrite: (rel) => check(writeSet, rel, "write"),
  };
}

export function llmAccessPolicy(
  projectRootPath: string,
  aiDeniedPaths: readonly string[],
  extraRules?: ReadonlyArray<PathRule>,
): AccessPolicy {
  return createPolicy(projectRootPath, LLM_READ, LLM_WRITE, aiDeniedPaths, extraRules);
}

export function serverAccessPolicy(projectRootPath: string): AccessPolicy {
  return createPolicy(projectRootPath, SRV_READ, SRV_WRITE, []);
}
