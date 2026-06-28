import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import { Type } from "@sinclair/typebox";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { AccessPolicy } from "../access/access-policy.js";
import { shouldSkipDirEntry } from "../utils/fs-walk.js";
import { resolveProjectPath } from "../utils/path-safety.js";

type AccessPolicyProvider = () => AccessPolicy;

const ListFilesParams = Type.Object({
  path: Type.String({ description: "Directory path relative to project root" }),
  recursive: Type.Optional(Type.Boolean({ description: "List recursively", default: false })),
  depth: Type.Optional(Type.Number({ description: "Max recursion depth (only effective when recursive=true). Default: unlimited", minimum: 1 })),
});

async function listRecursive(
  dirPath: string,
  prefix: string,
  lines: string[],
  projectRoot: string,
  policy: AccessPolicy,
  currentDepth: number,
  maxDepth: number,
): Promise<void> {
  const entries = await fs.readdir(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    if (shouldSkipDirEntry(entry.name)) continue;
    const icon = entry.isDirectory() ? "📁" : "📄";
    const entryPath = path.join(dirPath, entry.name);
    const relativePath = path.relative(projectRoot, entryPath).split(path.sep).join("/");
    if (!policy.canRead(relativePath)) continue;
    lines.push(`${prefix}${icon} ${entry.name}`);
    if (entry.isDirectory() && currentDepth < maxDepth) {
      await listRecursive(entryPath, `${prefix}  `, lines, projectRoot, policy, currentDepth + 1, maxDepth);
    }
  }
}

async function listFlat(
  dirPath: string,
  lines: string[],
  projectRoot: string,
  policy: AccessPolicy,
): Promise<void> {
  const entries = await fs.readdir(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    if (shouldSkipDirEntry(entry.name)) continue;
    const icon = entry.isDirectory() ? "📁" : "📄";
    const entryPath = path.join(dirPath, entry.name);
    const relativePath = path.relative(projectRoot, entryPath).split(path.sep).join("/");
    if (!policy.canRead(relativePath)) continue;
    lines.push(`${icon} ${entry.name}`);
  }
}

export function createListFilesTool(
  projectRoot: string,
  getPolicy: AccessPolicyProvider,
): AgentTool<typeof ListFilesParams> {
  const root = path.resolve(projectRoot);

  return {
    name: "list_files",
    label: "List Files",
    description: "List files and directories in a project path. Returns tree with 📁/📄 prefix.",
    parameters: ListFilesParams,
    async execute(_toolCallId, params, _signal) {
      const resolved = resolveProjectPath(root, params.path);
      const policy = getPolicy();

      if (params.path && params.path !== ".") {
        try {
          policy.assertRead(params.path);
        } catch (err) {
          return {
            content: [{ type: "text" as const, text: (err as Error).message }],
            details: { path: params.path, denied: true },
          };
        }
      }

      if (!fsSync.existsSync(resolved)) {
        return {
          content: [{ type: "text" as const, text: `Directory not found: ${params.path}` }],
          details: { path: params.path, exists: false },
        };
      }

      const stat = await fs.stat(resolved);
      if (!stat.isDirectory()) {
        return {
          content: [{ type: "text" as const, text: `Not a directory: ${params.path}` }],
          details: { path: params.path, isDirectory: false },
        };
      }

      const lines: string[] = [];
      const recursive = params.recursive ?? false;

      if (recursive) {
        const maxDepth = params.depth ?? Infinity;
        await listRecursive(resolved, "", lines, root, policy, 1, maxDepth);
      } else {
        await listFlat(resolved, lines, root, policy);
      }

      return {
        content: [{ type: "text" as const, text: lines.join("\n") || "(empty directory)" }],
        details: { path: params.path, recursive, depth: params.depth, count: lines.length },
      };
    },
  };
}
