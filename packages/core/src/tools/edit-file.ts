import fs from "node:fs/promises";
import path from "node:path";
import { Type } from "@sinclair/typebox";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { AccessPolicy } from "../access/access-policy.js";
import type { FileWriteMutex } from "../utils/file-write-mutex.js";
import { resolveProjectPath } from "../utils/path-safety.js";

type AccessPolicyProvider = () => AccessPolicy;

const EditFileParams = Type.Object({
  path: Type.String({ description: "Path relative to project root" }),
  old_string: Type.String({ description: "The exact text to find and replace in the file" }),
  new_string: Type.String({ description: "The text to replace old_string with. Use empty string to delete." }),
  replace_all: Type.Optional(Type.Boolean({ description: "Replace all occurrences of old_string. Default false.", default: false })),
});

export function createEditFileTool(
  projectRoot: string,
  mutex: FileWriteMutex,
  getPolicy: AccessPolicyProvider,
): AgentTool<typeof EditFileParams> {
  const root = path.resolve(projectRoot);

  return {
    name: "edit_file",
    label: "Edit File",
    description:
      "Edit a file by replacing exact text matches. Provide old_string (must appear in the file) and new_string (replacement text). " +
      "Fails if old_string is not found or matches multiple times unless replace_all is true.",
    parameters: EditFileParams,
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
        getPolicy().assertWrite(params.path);
      } catch (err) {
        return {
          content: [{ type: "text" as const, text: (err as Error).message }],
          details: { path: params.path, denied: true },
        };
      }

      const replaceAll = params.replace_all ?? false;

      return mutex.run(resolved, async () => {
        let content: string;
        try {
          content = await fs.readFile(resolved, "utf-8");
        } catch {
          return {
            content: [{ type: "text" as const, text: `Error: file not found at ${params.path}` }],
            details: undefined,
          };
        }

        const matchCount = content.split(params.old_string).length - 1;

        if (matchCount === 0) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Error: old_string not found in ${params.path}. Make sure the text matches exactly, including whitespace and indentation.`,
              },
            ],
            details: undefined,
          };
        }

        if (matchCount > 1 && !replaceAll) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Error: old_string matches ${matchCount} locations in ${params.path}. Provide more surrounding context to make it unique, or set replace_all to true.`,
              },
            ],
            details: undefined,
          };
        }

        const newContent = replaceAll
          ? content.replaceAll(params.old_string, params.new_string)
          : content.replace(params.old_string, params.new_string);

        await fs.writeFile(resolved, newContent, "utf-8");

        return {
          content: [
            {
              type: "text" as const,
              text: `Successfully edited ${params.path}: replaced ${replaceAll ? matchCount : 1} occurrence(s)`,
            },
          ],
          details: { path: params.path, replacements: replaceAll ? matchCount : 1 },
        };
      });
    },
  };
}
