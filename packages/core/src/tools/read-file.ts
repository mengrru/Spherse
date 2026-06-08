import fs from "node:fs/promises";
import path from "node:path";
import { Type } from "@sinclair/typebox";
import type { AgentTool } from "@mariozechner/pi-agent-core";
import { createAiFileAccessPolicy, type AiFileAccessPolicy } from "../access/ai-file-access.js";
import { resolveProjectPath } from "../utils/path-safety.js";

type AiFileAccessPolicyProvider = () => AiFileAccessPolicy;

const ReadFileParams = Type.Object({
  path: Type.String({ description: "Path relative to project root" }),
});

export function createReadFileTool(
  projectRoot: string,
  getAiFileAccessPolicy: AiFileAccessPolicyProvider = () => createAiFileAccessPolicy(projectRoot, []),
): AgentTool<typeof ReadFileParams> {
  const root = path.resolve(projectRoot);

  return {
    name: "read_file",
    label: "Read File",
    description: "Read the content of a file in the project. Returns the file content as text.",
    parameters: ReadFileParams,
    async execute(_toolCallId, params, _signal) {
      const resolved = resolveProjectPath(root, params.path);
      try {
        getAiFileAccessPolicy().assertReadableByAi(params.path);
      } catch (err) {
        return {
          content: [{ type: "text" as const, text: (err as Error).message }],
          details: { path: params.path, denied: true },
        };
      }

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
