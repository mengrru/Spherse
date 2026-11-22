import path from "node:path";
import { Type } from "@sinclair/typebox";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { AccessPolicyProvider } from "../access/access-policy.js";
import type { FileWriteMutex } from "../utils/file-write-mutex.js";
import type { FsPort } from "../store/fs-port.js";
import { resolveProjectPath } from "../utils/path-safety.js";

const MoveFileParams = Type.Object({
  source: Type.String({ description: "Source path relative to project root" }),
  destination: Type.String({ description: "Destination path relative to project root" }),
});

export function createMoveFileTool(
  projectRoot: string,
  fsPort: FsPort,
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
      const relSource = path.relative(root, resolvedSource).split(path.sep).join("/");
      const relDest = path.relative(root, resolvedDest).split(path.sep).join("/");
      const policy = getPolicy();

      try {
        policy.assertMoveSource(params.source);
      } catch (err) {
        return {
          content: [{ type: "text" as const, text: (err as Error).message }],
          details: { source: params.source, denied: true },
        };
      }

      try {
        policy.assertTransferDest(params.destination);
      } catch (err) {
        return {
          content: [{ type: "text" as const, text: (err as Error).message }],
          details: { source: params.source, destination: params.destination, denied: true },
        };
      }

      if ((await fsPort.stat(relSource)) === null) {
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
        if ((await fsPort.stat(relDest)) !== null) {
          return {
            content: [{ type: "text" as const, text: `Destination already exists: ${params.destination}` }],
            details: { source: params.source, destination: params.destination, destinationExists: true },
          };
        }

        await fsPort.mkdirp(path.posix.dirname(relDest));

        try {
          await fsPort.rename(relSource, relDest);
        } catch (err: unknown) {
          if (err instanceof Error && (err as NodeJS.ErrnoException).code === "EXDEV") {
            const sourceStat = await fsPort.stat(relSource);
            if (sourceStat !== null && sourceStat.isDirectory) {
              await fsPort.copyTree(relSource, relDest);
              await fsPort.rm(relSource, { recursive: true });
            } else {
              await fsPort.copyFile(relSource, relDest);
              await fsPort.unlink(relSource);
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
