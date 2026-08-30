import fs from "node:fs/promises";
import {
  CONTEXT_TOTAL_SIZE_LIMIT_BYTES,
  isTextContextPath,
} from "@spherse/presets";
import { ValidationError } from "../errors.js";
import { resolveProjectPath } from "../utils/path-safety.js";

export interface ContextFileStat {
  path: string;
  exists: boolean;
  sizeBytes: number;
  allowed: boolean;
}

export async function inspectContextFiles(
  projectRoot: string,
  paths: readonly string[],
): Promise<ContextFileStat[]> {
  const stats: ContextFileStat[] = [];
  for (const relPath of paths) {
    const allowed = isTextContextPath(relPath);
    let exists = false;
    let sizeBytes = 0;
    try {
      const resolved = resolveProjectPath(projectRoot, relPath);
      const stat = await fs.stat(resolved);
      if (stat.isFile()) {
        exists = true;
        sizeBytes = stat.size;
      }
    } catch {
      // traversal or missing: report as non-existent
    }
    stats.push({ path: relPath, exists, sizeBytes, allowed });
  }
  return stats;
}

function formatKb(bytes: number): string {
  return `${(bytes / 1024).toFixed(1)} kB`;
}

export async function assertContextFilesWithinPolicy(
  projectRoot: string,
  context: unknown,
): Promise<void> {
  if (!Array.isArray(context) || context.length === 0) return;
  if (!context.every((item): item is string => typeof item === "string")) return;

  const stats = await inspectContextFiles(projectRoot, context);

  const disallowed = stats.filter((s) => !s.allowed).map((s) => s.path);
  if (disallowed.length > 0) {
    throw new ValidationError(
      `context file(s) not allowed (plain-text files only): ${disallowed.join(", ")}`,
    );
  }

  const existing = stats.filter((s) => s.exists);
  const total = existing.reduce((sum, s) => sum + s.sizeBytes, 0);
  if (total > CONTEXT_TOTAL_SIZE_LIMIT_BYTES) {
    const breakdown = existing.map((s) => `${s.path} (${formatKb(s.sizeBytes)})`).join(", ");
    throw new ValidationError(
      `context files total size ${formatKb(total)} exceeds the ${formatKb(CONTEXT_TOTAL_SIZE_LIMIT_BYTES)} limit: ${breakdown}`,
    );
  }
}
