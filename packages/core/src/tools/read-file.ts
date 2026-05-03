import fs from "node:fs/promises";
import path from "node:path";
import { Type, type Static } from "@sinclair/typebox";
import type { AgentTool } from "@mariozechner/pi-agent-core";

const ReadFileParams = Type.Object({
  path: Type.String({ description: "Path relative to project root" }),
});

function validatePath(projectRoot: string, relativePath: string): string {
  const resolved = path.resolve(projectRoot, relativePath);
  if (!resolved.startsWith(projectRoot)) {
    throw new Error(`Path traversal denied: ${relativePath}`);
  }
  return resolved;
}

export function createReadFileTool(projectRoot: string): AgentTool<typeof ReadFileParams> {
  const root = path.resolve(projectRoot);

  return {
    name: "read_file",
    label: "Read File",
    description: "Read the content of a file in the project. Returns the file content as text.",
    parameters: ReadFileParams,
    async execute(_toolCallId, params, _signal) {
      const resolved = validatePath(root, params.path);
      try {
        const content = await fs.readFile(resolved, "utf-8");
        return {
          content: [{ type: "text" as const, text: content }],
          details: { path: params.path, size: content.length },
        };
      } catch {
        return {
          content: [{ type: "text" as const, text: `Error: file not found at ${params.path}` }],
          details: undefined,
        };
      }
    },
  };
}
