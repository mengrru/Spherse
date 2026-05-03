import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import { Type, type Static } from "@sinclair/typebox";
import type { AgentTool } from "@mariozechner/pi-agent-core";

const ListFilesParams = Type.Object({
  path: Type.String({ description: "Directory path relative to project root" }),
  recursive: Type.Optional(Type.Boolean({ description: "List recursively", default: false })),
});

function validatePath(projectRoot: string, relativePath: string): string {
  const resolved = path.resolve(projectRoot, relativePath);
  if (!resolved.startsWith(projectRoot)) {
    throw new Error(`Path traversal denied: ${relativePath}`);
  }
  return resolved;
}

async function listRecursive(dirPath: string, prefix: string, lines: string[]): Promise<void> {
  const entries = await fs.readdir(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    const icon = entry.isDirectory() ? "📁" : "📄";
    const entryPath = path.join(dirPath, entry.name);
    lines.push(`${prefix}${icon} ${entry.name}`);
    if (entry.isDirectory()) {
      await listRecursive(entryPath, `${prefix}  `, lines);
    }
  }
}

async function listFlat(dirPath: string, lines: string[]): Promise<void> {
  const entries = await fs.readdir(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    const icon = entry.isDirectory() ? "📁" : "📄";
    lines.push(`${icon} ${entry.name}`);
  }
}

export function createListFilesTool(projectRoot: string): AgentTool<typeof ListFilesParams> {
  const root = path.resolve(projectRoot);

  return {
    name: "list_files",
    label: "List Files",
    description: "List files and directories in a project path. Returns tree with 📁/📄 prefix.",
    parameters: ListFilesParams,
    async execute(_toolCallId, params, _signal) {
      const resolved = validatePath(root, params.path);

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
        await listRecursive(resolved, "", lines);
      } else {
        await listFlat(resolved, lines);
      }

      return {
        content: [{ type: "text" as const, text: lines.join("\n") || "(empty directory)" }],
        details: { path: params.path, recursive, count: lines.length },
      };
    },
  };
}
