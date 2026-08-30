import fs from "node:fs/promises";
import type { AccessPolicy } from "../access/access-policy.js";
import type { Logger } from "../logger.js";
import { CONTEXT_TOTAL_SIZE_LIMIT_BYTES, isTextContextPath } from "@spherse/presets";

export interface ContextFile {
  path: string;
  content: string;
}

import { resolveProjectPath } from "../utils/path-safety.js";

export async function readContextFiles(
  projectRoot: string,
  contextPaths: string[] | undefined,
  getAccessPolicy?: () => AccessPolicy,
  logger?: Logger,
): Promise<ContextFile[]> {
  if (!contextPaths || contextPaths.length === 0) return [];

  const files: ContextFile[] = [];
  let usedBytes = 0;

  for (const relPath of contextPaths) {
    let resolved: string;
    try {
      resolved = resolveProjectPath(projectRoot, relPath);
    } catch {
      continue;
    }
    if (getAccessPolicy && !getAccessPolicy().canRead(relPath)) {
      continue;
    }
    if (!isTextContextPath(relPath)) {
      logger?.warn({ path: relPath }, "context file skipped: not a plain-text file");
      continue;
    }

    try {
      const stat = await fs.stat(resolved);
      if (!stat.isFile()) continue;
      if (usedBytes + stat.size > CONTEXT_TOTAL_SIZE_LIMIT_BYTES) {
        logger?.warn(
          { path: relPath, sizeBytes: stat.size, usedBytes, limitBytes: CONTEXT_TOTAL_SIZE_LIMIT_BYTES },
          "context file skipped: total size limit exceeded",
        );
        continue;
      }
      const content = await fs.readFile(resolved, "utf-8");
      files.push({ path: relPath, content });
      usedBytes += stat.size;
    } catch {
      continue;
    }
  }

  return files;
}
