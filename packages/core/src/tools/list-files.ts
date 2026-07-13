import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import { Type } from "@sinclair/typebox";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { AccessPolicy } from "../access/access-policy.js";
import { resolveProjectPath, isProjectMetaPath } from "../utils/path-safety.js";
import { PROJECT_META_DIR } from "../types.js";

type AccessPolicyProvider = () => AccessPolicy;

const ListFilesParams = Type.Object({
  path: Type.String({ description: "Directory path relative to project root" }),
  recursive: Type.Optional(Type.Boolean({ description: "List recursively", default: false })),
  depth: Type.Optional(Type.Number({ description: "Max recursion depth (only effective when recursive=true). Default: unlimited", minimum: 1 })),
  include_meta: Type.Optional(Type.Boolean({
    description:
      "Whether to list files inside the .spherse project-metadata directory. Default: false. .spherse stores agent definitions, session databases, skills, generated images, and project config. Keep the default unless you specifically need to inspect project metadata.",
    default: false,
  })),
});

function shouldSkipEntry(name: string, includeMeta: boolean): boolean {
  if (name === PROJECT_META_DIR) return !includeMeta;
  return name.startsWith(".") || name === "node_modules";
}

async function listRecursive(
  dirPath: string,
  prefix: string,
  lines: string[],
  projectRoot: string,
  policy: AccessPolicy,
  currentDepth: number,
  maxDepth: number,
  includeMeta: boolean,
): Promise<void> {
  const entries = await fs.readdir(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    if (shouldSkipEntry(entry.name, includeMeta)) continue;
    const entryPath = path.join(dirPath, entry.name);
    const relativePath = path.relative(projectRoot, entryPath).split(path.sep).join("/");
    const isDir = entry.isDirectory();
    if (!policy.canRead(relativePath)) continue;

    const icon = isDir ? "📁" : "📄";
    lines.push(`${prefix}${icon} ${entry.name}`);

    if (isDir && currentDepth < maxDepth) {
      await listRecursive(entryPath, `${prefix}  `, lines, projectRoot, policy, currentDepth + 1, maxDepth, includeMeta);
    }
  }
}

async function listFlat(
  dirPath: string,
  lines: string[],
  projectRoot: string,
  policy: AccessPolicy,
  includeMeta: boolean,
): Promise<void> {
  const entries = await fs.readdir(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    if (shouldSkipEntry(entry.name, includeMeta)) continue;
    const entryPath = path.join(dirPath, entry.name);
    const relativePath = path.relative(projectRoot, entryPath).split(path.sep).join("/");
    const isDir = entry.isDirectory();
    if (!policy.canRead(relativePath)) continue;

    const icon = isDir ? "📁" : "📄";
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
    description:
      "List files and directories in a project path. Returns a tree with 📁/📄 prefixes. Skips dotfiles and node_modules. The .spherse metadata directory is excluded by default; set include_meta=true to list it.",
    parameters: ListFilesParams,
    async execute(_toolCallId, params, _signal) {
      const resolved = resolveProjectPath(root, params.path);
      const policy = getPolicy();
      const includeMeta = params.include_meta ?? false;

      if (params.path && params.path !== ".") {
        if (!includeMeta && isProjectMetaPath(params.path)) {
          return {
            content: [{ type: "text" as const, text: `Set include_meta=true to list the ${PROJECT_META_DIR} directory.` }],
            details: { path: params.path, denied: true },
          };
        }
        if (!policy.canRead(params.path)) {
          return {
            content: [{ type: "text" as const, text: `Access denied: listing of "${params.path}" is not permitted` }],
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
        await listRecursive(resolved, "", lines, root, policy, 1, maxDepth, includeMeta);
      } else {
        await listFlat(resolved, lines, root, policy, includeMeta);
      }

      return {
        content: [{ type: "text" as const, text: lines.join("\n") || "(empty directory)" }],
        details: { path: params.path, recursive, depth: params.depth, include_meta: includeMeta, count: lines.length },
      };
    },
  };
}
