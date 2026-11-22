import path from "node:path";
import type { AccessPolicy } from "../access/access-policy.js";
import type { FsPort } from "../store/fs-port.js";
export interface ContextFile {
  path: string;
  content: string;
}

import { resolveProjectPath } from "../utils/path-safety.js";

export async function readContextFiles(
  projectRoot: string,
  fsPort: FsPort,
  contextPaths: string[] | undefined,
  getAccessPolicy?: () => AccessPolicy,
): Promise<ContextFile[]> {
  if (!contextPaths || contextPaths.length === 0) return [];

  const root = path.resolve(projectRoot);
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
      const content = await fsPort.readFile(path.relative(root, resolved).split(path.sep).join("/"));
      files.push({ path: relPath, content });
    } catch {
      continue;
    }
  }

  return files;
}
