import { categorizePath, ruleForPath, type PathCategory, type PathRule } from "./path-category.js";
import { normalizeProjectRelativePath } from "./denied-paths.js";
import { resolveProjectPath } from "../utils/path-safety.js";
import { AccessDeniedError } from "../errors.js";

export type Decision = { allowed: true } | { allowed: false; reason: string };

export interface AccessPolicy {
  assertRead(relativePath: string): void;
  assertWrite(relativePath: string): void;
  assertTransferDest(relativePath: string): void;
  assertMoveSource(relativePath: string): void;
  canRead(relativePath: string): boolean;
  canWrite(relativePath: string): boolean;
  canTransferDest(relativePath: string): boolean;
  canMoveSource(relativePath: string): boolean;
}

export type AccessPolicyProvider = () => AccessPolicy;

type ActionKind = "read" | "write" | "transferDest" | "moveSource";

const ACTION_LABELS: Record<ActionKind, string> = {
  read: "read",
  write: "write",
  transferDest: "transfer destination",
  moveSource: "move source",
};

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
  "agentAssets",
  "agentTriggers",
  "agentTriggerLogs",
  "spherseMetaDir",
  "spherseOther",
]);

const LLM_WRITE: ReadonlySet<PathCategory> = new Set<PathCategory>([
  "userFiles",
  "rootIndex",
  "projectTheme",
  "skills",
  "agentTheme",
  "agentSkills",
  "agentAssets",
]);

const LLM_TRANSFER_DEST: ReadonlySet<PathCategory> = new Set<PathCategory>([
  "userFiles",
  "projectTheme",
  "skills",
  "agentTheme",
  "agentSkills",
  "agentAssets",
]);

const LLM_MOVE_SOURCE: ReadonlySet<PathCategory> = new Set<PathCategory>([
  "userFiles",
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
  "agentAssets",
  "agentTriggers",
  "agentTriggerLogs",
  "spherseMetaDir",
  "spherseOther",
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
  "agentAssets",
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
  action: ActionKind,
  extraRules?: ReadonlyArray<PathRule>,
): void {
  resolveProjectPath(projectRootPath, relativePath);

  const normalized = normalizeProjectRelativePath(relativePath);
  if (normalized !== null) {
    for (const denied of deniedPaths) {
      if (normalized === denied || normalized.startsWith(`${denied}/`)) {
        throw new AccessDeniedError(
          `Access denied: ${ACTION_LABELS[action]} of "${relativePath}" is blocked by denied path "${denied}"`,
        );
      }
    }
  }

  const matchedRule = ruleForPath(relativePath, extraRules);
  if (matchedRule) {
    const allowedByRule = action === "read" ? matchedRule.llm.read : matchedRule.llm.write;
    if (!allowedByRule) {
      throw new AccessDeniedError(
        `Access denied: ${ACTION_LABELS[action]} of "${relativePath}" (category "${matchedRule.category}") is not permitted`,
      );
    }
    return;
  }

  const category = categorizePath(relativePath);
  if (!allowed.has(category)) {
    throw new AccessDeniedError(
      `Access denied: ${ACTION_LABELS[action]} of "${relativePath}" (category "${category}") is not permitted`,
    );
  }
}

function createPolicy(
  projectRootPath: string,
  readSet: ReadonlySet<PathCategory>,
  writeSet: ReadonlySet<PathCategory>,
  transferDestSet: ReadonlySet<PathCategory>,
  moveSourceSet: ReadonlySet<PathCategory>,
  deniedPaths: readonly string[],
  extraRules?: ReadonlyArray<PathRule>,
): AccessPolicy {
  const check = (
    set: ReadonlySet<PathCategory>,
    relativePath: string,
    action: ActionKind,
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
    assertTransferDest: (rel) =>
      assertAllowed(projectRootPath, transferDestSet, deniedPaths, rel, "transferDest", extraRules),
    assertMoveSource: (rel) =>
      assertAllowed(projectRootPath, moveSourceSet, deniedPaths, rel, "moveSource", extraRules),
    canRead: (rel) => check(readSet, rel, "read"),
    canWrite: (rel) => check(writeSet, rel, "write"),
    canTransferDest: (rel) => check(transferDestSet, rel, "transferDest"),
    canMoveSource: (rel) => check(moveSourceSet, rel, "moveSource"),
  };
}

export function llmAccessPolicy(
  projectRootPath: string,
  aiDeniedPaths: readonly string[],
  extraRules?: ReadonlyArray<PathRule>,
): AccessPolicy {
  return createPolicy(
    projectRootPath,
    LLM_READ,
    LLM_WRITE,
    LLM_TRANSFER_DEST,
    LLM_MOVE_SOURCE,
    aiDeniedPaths,
    extraRules,
  );
}

export function serverAccessPolicy(projectRootPath: string): AccessPolicy {
  return createPolicy(projectRootPath, SRV_READ, SRV_WRITE, SRV_WRITE, SRV_WRITE, []);
}
