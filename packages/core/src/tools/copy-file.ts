import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import { Type } from "@sinclair/typebox";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { AccessPolicyProvider } from "../access/access-policy.js";
import type { FileWriteMutex } from "../utils/file-write-mutex.js";
import { resolveProjectPath } from "../utils/path-safety.js";

const CopyFileParams = Type.Object({
  source: Type.String({ description: "Source file path relative to project root" }),
  destination: Type.String({ description: "Destination file path relative to project root" }),
});

export function createCopyFileTool(
  projectRoot: string,
  mutex: FileWriteMutex,
  getPolicy: AccessPolicyProvider,
): AgentTool<typeof CopyFileParams> {
  const root = path.resolve(projectRoot);

  return {
    name: "copy_file",
    label: "Copy File",
    description: "Copy a file within the project. Does not support directories. Fails if destination already exists.",
    parameters: CopyFileParams,
    async execute(_toolCallId, params, _signal) {
      const resolvedSource = resolveProjectPath(root, params.source);
      const resolvedDest = resolveProjectPath(root, params.destination);
      const policy = getPolicy();

      try {
        policy.assertRead(params.source);
      } catch (err) {
        return {
          content: [{ type: "text" as const, text: (err as Error).message }],
          details: { source: params.source, denied: true },
        };
      }

      try {
        getPolicy().assertWrite(params.destination);
      } catch (err) {
        return {
          content: [{ type: "text" as const, text: (err as Error).message }],
          details: { source: params.source, destination: params.destination, denied: true },
        };
      }

      if (!fsSync.existsSync(resolvedSource)) {
        return {
          content: [{ type: "text" as const, text: `Source not found: ${params.source}` }],
          details: { source: params.source, exists: false },
        };
      }

      const sourceStat = await fs.stat(resolvedSource);
      if (sourceStat.isDirectory()) {
        return {
          content: [{ type: "text" as const, text: `Source is a directory, copy_file only supports files: ${params.source}` }],
          details: { source: params.source, isDirectory: true },
        };
      }

      if (fsSync.existsSync(resolvedDest)) {
        return {
          content: [{ type: "text" as const, text: `Destination already exists: ${params.destination}` }],
          details: { source: params.source, destination: params.destination, destinationExists: true },
        };
      }

      return mutex.run(resolvedDest, async () => {
        if (fsSync.existsSync(resolvedDest)) {
          return {
            content: [{ type: "text" as const, text: `Destination already exists: ${params.destination}` }],
            details: { source: params.source, destination: params.destination, destinationExists: true },
          };
        }

        await fs.mkdir(path.dirname(resolvedDest), { recursive: true });
        await fs.copyFile(resolvedSource, resolvedDest);

        return {
          content: [{ type: "text" as const, text: `Successfully copied ${params.source} to ${params.destination}` }],
          details: { source: params.source, destination: params.destination },
        };
      });
    },
  };
}
