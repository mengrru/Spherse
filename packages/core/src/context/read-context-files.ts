import fs from "node:fs/promises";
import type { AccessPolicy } from "../access/access-policy.js";
export interface ContextFile {
  path: string;
  content: string;
}

import { resolveProjectPath } from "../utils/path-safety.js";

export async function readContextFiles(
  projectRoot: string,
  contextPaths: string[] | undefined,
  getAccessPolicy?: () => AccessPolicy,
): Promise<ContextFile[]> {
  if (!contextPaths || contextPaths.length === 0) return [];

  const files: ContextFile[] = [];

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

    try {
      const content = await fs.readFile(resolved, "utf-8");
      files.push({ path: relPath, content });
    } catch {
      continue;
    }
  }

  return files;
}
