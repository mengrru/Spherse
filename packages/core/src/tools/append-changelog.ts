import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import { Type } from "@sinclair/typebox";
import type { AgentTool } from "@mariozechner/pi-agent-core";
import type { FileWriteMutex } from "../utils/file-write-mutex.js";
import { resolveProjectPath } from "../utils/path-safety.js";

const AppendChangelogParams = Type.Object({
  agent: Type.String({ description: "Name of the agent performing the action" }),
  action: Type.String({ description: "Action type (e.g. create, update, delete)" }),
  target: Type.String({ description: "Target file or entity affected" }),
  description: Type.String({ description: "Human-readable description of what was done" }),
});

export function createAppendChangelogTool(projectRoot: string, changelogPath: string | undefined, mutex: FileWriteMutex): AgentTool<typeof AppendChangelogParams> {
  const root = path.resolve(projectRoot);
  const defaultChangelog = path.join(root, "CHANGELOG.md");

  return {
    name: "append_changelog",
    label: "Append Changelog",
    description: "Append a changelog entry to CHANGELOG.md with timestamp, agent, action, and target.",
    parameters: AppendChangelogParams,
    async execute(_toolCallId, params, _signal) {
      const resolved = changelogPath ? resolveProjectPath(root, changelogPath) : defaultChangelog;

      return mutex.run(resolved, async () => {
        const timestamp = new Date().toISOString();
        const entry = `- **[${timestamp}]** ${params.agent} / ${params.action} / \`${params.target}\` — ${params.description}\n`;

        const dir = path.dirname(resolved);
        if (!fsSync.existsSync(dir)) {
          await fs.mkdir(dir, { recursive: true });
        }

        await fs.appendFile(resolved, entry, "utf-8");

        return {
          content: [{ type: "text" as const, text: `Changelog entry appended` }],
          details: { timestamp, agent: params.agent, action: params.action, target: params.target },
        };
      });
    },
  };
}
