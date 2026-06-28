import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import { Type } from "@sinclair/typebox";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { AccessPolicy } from "../access/access-policy.js";
import type { FileWriteMutex } from "../utils/file-write-mutex.js";
import { resolveProjectPath } from "../utils/path-safety.js";

type AccessPolicyProvider = () => AccessPolicy;

const MoveFileParams = Type.Object({
  source: Type.String({ description: "Source path relative to project root" }),
  destination: Type.String({ description: "Destination path relative to project root" }),
});

export function createMoveFileTool(
  projectRoot: string,
  mutex: FileWriteMutex,
  getPolicy: AccessPolicyProvider,
): AgentTool<typeof MoveFileParams> {
  const root = path.resolve(projectRoot);

  return {
    name: "move_file",
    label: "Move File",
    description: "Move or rename a file or directory within the project. Fails if destination already exists.",
    parameters: MoveFileParams,
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

      if (resolvedDest === resolvedSource || resolvedDest.startsWith(resolvedSource + path.sep)) {
        return {
          content: [{ type: "text" as const, text: `Cannot move into itself: ${params.source} → ${params.destination}` }],
          details: { source: params.source, destination: params.destination },
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

        try {
          await fs.rename(resolvedSource, resolvedDest);
        } catch (err: unknown) {
          if (err instanceof Error && (err as NodeJS.ErrnoException).code === "EXDEV") {
            const sourceStat = await fs.stat(resolvedSource);
            if (sourceStat.isDirectory()) {
              await fs.cp(resolvedSource, resolvedDest, { recursive: true });
              await fs.rm(resolvedSource, { recursive: true, force: true });
            } else {
              await fs.copyFile(resolvedSource, resolvedDest);
              await fs.unlink(resolvedSource);
            }
          } else {
            throw err;
          }
        }

        return {
          content: [{ type: "text" as const, text: `Successfully moved ${params.source} to ${params.destination}` }],
          details: { source: params.source, destination: params.destination },
        };
      });
    },
  };
}
