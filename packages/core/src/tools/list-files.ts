import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import { Type } from "@sinclair/typebox";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { AccessPolicy } from "../access/access-policy.js";
import { resolveProjectPath } from "../utils/path-safety.js";

type AccessPolicyProvider = () => AccessPolicy;

const ListFilesParams = Type.Object({
  path: Type.String({ description: "Directory path relative to project root" }),
  recursive: Type.Optional(Type.Boolean({ description: "List recursively", default: false })),
  depth: Type.Optional(Type.Number({ description: "Max recursion depth (only effective when recursive=true). Default: unlimited", minimum: 1 })),
});

const SPHERSE_DIR = ".spherse";
const AGENTS_DIR = `${SPHERSE_DIR}/agents`;

function shouldSkipEntry(name: string): boolean {
  if (name === SPHERSE_DIR) return false;
  return name.startsWith(".") || name === "node_modules";
}

function getAgentSegment(relativePath: string): string | null {
  const prefix = `${AGENTS_DIR}/`;
  if (!relativePath.startsWith(prefix)) return null;
  const rest = relativePath.slice(prefix.length);
  const slashIdx = rest.indexOf("/");
  return slashIdx >= 0 ? rest.slice(0, slashIdx) : rest;
}

function isOwnAgentDir(relativePath: string, agentSlug?: string): boolean {
  if (!agentSlug) return false;
  const ownPrefix = `${AGENTS_DIR}/${agentSlug}`;
  return relativePath === ownPrefix || relativePath.startsWith(`${ownPrefix}/`);
}

function canListEntry(relativePath: string, isDir: boolean, policy: AccessPolicy, agentSlug?: string): boolean {
  const agentSeg = getAgentSegment(relativePath);
  if (agentSeg !== null && agentSeg !== agentSlug) return false;
  if (policy.canRead(relativePath)) return true;
  return isDir && isOwnAgentDir(relativePath, agentSlug);
}

async function listRecursive(
  dirPath: string,
  prefix: string,
  lines: string[],
  projectRoot: string,
  policy: AccessPolicy,
  currentDepth: number,
  maxDepth: number,
  agentSlug?: string,
): Promise<void> {
  const entries = await fs.readdir(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    if (shouldSkipEntry(entry.name)) continue;
    const entryPath = path.join(dirPath, entry.name);
    const relativePath = path.relative(projectRoot, entryPath).split(path.sep).join("/");
    const isDir = entry.isDirectory();
    if (!canListEntry(relativePath, isDir, policy, agentSlug)) continue;

    const icon = isDir ? "📁" : "📄";
    lines.push(`${prefix}${icon} ${entry.name}`);

    if (isDir && currentDepth < maxDepth) {
      await listRecursive(entryPath, `${prefix}  `, lines, projectRoot, policy, currentDepth + 1, maxDepth, agentSlug);
    }
  }
}

async function listFlat(
  dirPath: string,
  lines: string[],
  projectRoot: string,
  policy: AccessPolicy,
  agentSlug?: string,
): Promise<void> {
  const entries = await fs.readdir(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    if (shouldSkipEntry(entry.name)) continue;
    const entryPath = path.join(dirPath, entry.name);
    const relativePath = path.relative(projectRoot, entryPath).split(path.sep).join("/");
    const isDir = entry.isDirectory();
    if (!canListEntry(relativePath, isDir, policy, agentSlug)) continue;

    const icon = isDir ? "📁" : "📄";
    lines.push(`${icon} ${entry.name}`);
  }
}

export function createListFilesTool(
  projectRoot: string,
  getPolicy: AccessPolicyProvider,
  agentSlug?: string,
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
        if (!policy.canRead(params.path) && !isOwnAgentDir(params.path, agentSlug)) {
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
        await listRecursive(resolved, "", lines, root, policy, 1, maxDepth, agentSlug);
      } else {
        await listFlat(resolved, lines, root, policy, agentSlug);
      }

      return {
        content: [{ type: "text" as const, text: lines.join("\n") || "(empty directory)" }],
        details: { path: params.path, recursive, depth: params.depth, count: lines.length },
      };
    },
  };
}
