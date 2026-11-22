import path from "node:path";
import { Type } from "@sinclair/typebox";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { AccessPolicy, AccessPolicyProvider } from "../access/access-policy.js";
import type { FsPort } from "../store/fs-port.js";
import { resolveProjectPath, isProjectMetaPath } from "../utils/path-safety.js";
import { PROJECT_META_DIR } from "../types.js";

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
  fsPort: FsPort,
  relDir: string,
  prefix: string,
  lines: string[],
  policy: AccessPolicy,
  currentDepth: number,
  maxDepth: number,
  includeMeta: boolean,
): Promise<void> {
  const entries = await fsPort.readdir(relDir === "" ? "." : relDir);
  for (const entry of entries) {
    if (shouldSkipEntry(entry.name, includeMeta)) continue;
    const entryRel = relDir === "" ? entry.name : `${relDir}/${entry.name}`;
    const isDir = entry.isDirectory;
    if (!policy.canRead(entryRel)) continue;

    const icon = isDir ? "📁" : "📄";
    lines.push(`${prefix}${icon} ${entry.name}`);

    if (isDir && currentDepth < maxDepth) {
      await listRecursive(fsPort, entryRel, `${prefix}  `, lines, policy, currentDepth + 1, maxDepth, includeMeta);
    }
  }
}

async function listFlat(
  fsPort: FsPort,
  relDir: string,
  lines: string[],
  policy: AccessPolicy,
  includeMeta: boolean,
): Promise<void> {
  const entries = await fsPort.readdir(relDir === "" ? "." : relDir);
  for (const entry of entries) {
    if (shouldSkipEntry(entry.name, includeMeta)) continue;
    const entryRel = relDir === "" ? entry.name : `${relDir}/${entry.name}`;
    const isDir = entry.isDirectory;
    if (!policy.canRead(entryRel)) continue;

    const icon = isDir ? "📁" : "📄";
    lines.push(`${icon} ${entry.name}`);
  }
}

export function createListFilesTool(
  projectRoot: string,
  fsPort: FsPort,
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
      const rel = path.relative(root, resolved).split(path.sep).join("/");
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

      const stat = await fsPort.stat(rel);
      if (stat === null) {
        return {
          content: [{ type: "text" as const, text: `Directory not found: ${params.path}` }],
          details: { path: params.path, exists: false },
        };
      }

      if (!stat.isDirectory) {
        return {
          content: [{ type: "text" as const, text: `Not a directory: ${params.path}` }],
          details: { path: params.path, isDirectory: false },
        };
      }

      const lines: string[] = [];
      const recursive = params.recursive ?? false;

      if (recursive) {
        const maxDepth = params.depth ?? Infinity;
        await listRecursive(fsPort, rel, "", lines, policy, 1, maxDepth, includeMeta);
      } else {
        await listFlat(fsPort, rel, lines, policy, includeMeta);
      }

      return {
        content: [{ type: "text" as const, text: lines.join("\n") || "(empty directory)" }],
        details: { path: params.path, recursive, depth: params.depth, include_meta: includeMeta, count: lines.length },
      };
    },
  };
}
