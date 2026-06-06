import fs from "node:fs/promises";
import path from "node:path";
import type { AiFileAccessPolicy } from "../access/ai-file-access.js";

export async function readContextFiles(
  projectRoot: string,
  contextPaths: string[] | undefined,
  getAiFileAccessPolicy?: () => AiFileAccessPolicy,
): Promise<string> {
  if (!contextPaths || contextPaths.length === 0) return "";

  const sections: string[] = [];

  for (const relPath of contextPaths) {
    const resolved = path.resolve(projectRoot, relPath);
    if (!resolved.startsWith(projectRoot + path.sep) && resolved !== projectRoot) {
      continue;
    }
    if (getAiFileAccessPolicy?.().isDenied(relPath)) {
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
