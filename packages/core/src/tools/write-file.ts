import fs from "node:fs/promises";
import path from "node:path";
import { Type } from "@sinclair/typebox";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { AccessPolicy } from "../access/access-policy.js";
import type { FileWriteMutex } from "../utils/file-write-mutex.js";
import { resolveProjectPath } from "../utils/path-safety.js";
import { checkJson } from "./json-check.js";

type AccessPolicyProvider = () => AccessPolicy;

const WriteFileParams = Type.Object({
  path: Type.String({ description: "Path relative to project root" }),
  content: Type.String({ description: "Content to write to the file" }),
  createDirs: Type.Optional(Type.Boolean({ description: "Create parent directories if they don't exist", default: true })),
});

export function createWriteFileTool(
  projectRoot: string,
  mutex: FileWriteMutex,
  getPolicy: AccessPolicyProvider,
): AgentTool<typeof WriteFileParams> {
  const root = path.resolve(projectRoot);

  return {
    name: "write_file",
    label: "Write File",
    description:
      "Write content to a file in the project. Creates parent directories by default. " +
      "For .json files the content is validated and invalid JSON is rejected.",
    parameters: WriteFileParams,
    async execute(_toolCallId, params, _signal?: AbortSignal) {
      const resolved = resolveProjectPath(root, params.path);
      const createDirs = params.createDirs ?? true;

      try {
        getPolicy().assertWrite(params.path);
      } catch (err) {
        return {
          content: [{ type: "text" as const, text: (err as Error).message }],
          details: { path: params.path, denied: true },
        };
      }

      return mutex.run(resolved, async () => {
        if (path.extname(resolved).toLowerCase() === ".json") {
          const check = checkJson(params.content);
          if (!check.ok) {
            return {
              content: [
                {
                  type: "text" as const,
                  text: `Invalid JSON in ${params.path}: ${check.error}. Fix the JSON and try again.`,
                },
              ],
              details: { path: params.path, jsonError: true },
            };
          }
        }

        if (createDirs) {
          await fs.mkdir(path.dirname(resolved), { recursive: true });
        }

        await fs.writeFile(resolved, params.content, "utf-8");

        return {
          content: [{ type: "text" as const, text: `Successfully wrote ${params.content.length} bytes to ${params.path}` }],
          details: { path: params.path, size: params.content.length },
        };
      });
    },
  };
}
