import { Type } from "@sinclair/typebox";
import type { AgentTool } from "@mariozechner/pi-agent-core";
import type { ToolContext } from "./tool-context.js";

const AppendChangelogParams = Type.Object({
  agent: Type.String({ description: "Name of the agent performing the action" }),
  action: Type.String({ description: "Action type (e.g. create, update, delete)" }),
  target: Type.String({ description: "Target file or entity affected" }),
  description: Type.String({ description: "Human-readable description of what was done" }),
});

export function createAppendChangelogTool(ctx: ToolContext): AgentTool<typeof AppendChangelogParams> {
  return {
    name: "append_changelog",
    label: "Append Changelog",
    description: "Append a changelog entry to CHANGELOG.md with timestamp, agent, action, and target.",
    parameters: AppendChangelogParams,
    async execute(_toolCallId, params, _signal) {
      await ctx.appendChangelog({
        agent: params.agent,
        action: params.action,
        target: params.target,
        description: params.description,
      });

      return {
        content: [{ type: "text" as const, text: `Changelog entry appended` }],
        details: { agent: params.agent, action: params.action, target: params.target },
      };
    },
  };
}
