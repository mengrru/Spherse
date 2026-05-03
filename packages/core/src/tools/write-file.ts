import fs from "node:fs/promises";
import path from "node:path";
import { Type, type Static } from "@sinclair/typebox";
import type { AgentTool } from "@mariozechner/pi-agent-core";

const WriteFileParams = Type.Object({
  path: Type.String({ description: "Path relative to project root" }),
  content: Type.String({ description: "Content to write to the file" }),
  createDirs: Type.Optional(Type.Boolean({ description: "Create parent directories if they don't exist", default: true })),
});

function validatePath(projectRoot: string, relativePath: string): string {
  const resolved = path.resolve(projectRoot, relativePath);
  if (!resolved.startsWith(projectRoot)) {
    throw new Error(`Path traversal denied: ${relativePath}`);
  }
  return resolved;
}

export function createWriteFileTool(projectRoot: string): AgentTool<typeof WriteFileParams> {
  const root = path.resolve(projectRoot);

  return {
    name: "write_file",
    label: "Write File",
    description: "Write content to a file in the project. Creates parent directories by default.",
    parameters: WriteFileParams,
    async execute(_toolCallId, params, _signal) {
      const resolved = validatePath(root, params.path);
      const createDirs = params.createDirs ?? true;

      if (createDirs) {
        await fs.mkdir(path.dirname(resolved), { recursive: true });
      }

      await fs.writeFile(resolved, params.content, "utf-8");

      return {
        content: [{ type: "text" as const, text: `Successfully wrote ${params.content.length} bytes to ${params.path}` }],
        details: { path: params.path, size: params.content.length },
      };
    },
  };
}
