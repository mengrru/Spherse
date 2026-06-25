import fs from "node:fs/promises";
import type { AccessPolicy } from "../access/access-policy.js";
import { resolveProjectPath } from "../utils/path-safety.js";

export async function readContextFiles(
  projectRoot: string,
  contextPaths: string[] | undefined,
  getAccessPolicy?: () => AccessPolicy,
): Promise<string> {
  if (!contextPaths || contextPaths.length === 0) return "";

  const sections: string[] = [];

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
      sections.push(
        `<context-file path="${relPath}">\n${content}\n</context-file>`,
      );
    } catch {
      continue;
    }
  }

  if (sections.length === 0) return "";
  return `\n\n## Pre-loaded Context\n\n${sections.join("\n\n")}`;
}
