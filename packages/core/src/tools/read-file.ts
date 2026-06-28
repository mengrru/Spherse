import fs from "node:fs/promises";
import path from "node:path";
import { Type } from "@sinclair/typebox";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { AccessPolicy } from "../access/access-policy.js";
import { resolveProjectPath } from "../utils/path-safety.js";

type AccessPolicyProvider = () => AccessPolicy;

const ReadFileParams = Type.Object({
  path: Type.String({ description: "Path relative to project root" }),
});

export function createReadFileTool(
  projectRoot: string,
  getPolicy: AccessPolicyProvider,
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
        getPolicy().assertRead(params.path);
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
