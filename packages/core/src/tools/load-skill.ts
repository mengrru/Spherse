import path from "node:path";
import { Type } from "@sinclair/typebox";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { SkillStore } from "../store/skill.js";

const LoadSkillParams = Type.Object({
  skill_name: Type.String({ description: "Name of the skill to load" }),
});

export function createLoadSkillTool(
  projectRoot: string,
  skillStore: SkillStore,
  agentSkillStore?: SkillStore,
): AgentTool<typeof LoadSkillParams> {
  return {
    name: "load_skill",
    label: "Load Skill",
    description:
      "Load a skill's full instructions. Use this when you want to activate a skill from the available skills list.",
    parameters: LoadSkillParams,
    async execute(_toolCallId, params, _signal) {
      const skill =
        (await agentSkillStore?.get(params.skill_name)) ??
        (await skillStore.get(params.skill_name));
      if (!skill) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error: skill "${params.skill_name}" not found.`,
            },
          ],
          details: undefined,
        };
      }

      let text = `<skill-content name="${skill.name}">\n${skill.instructions}`;
      if (skill.source === "project" && skill.files.length > 0) {
        const skillDirRel = path
          .relative(projectRoot, path.dirname(skill.filePath))
          .split(path.sep)
          .join("/");
        const fileList = skill.files.map((f) => `- ${skillDirRel}/${f}`).join("\n");
        text += `\n\n## Skill Files\n\nThis skill has companion files you can read with the read_file tool:\n${fileList}`;
      }
      text += `\n</skill-content>`;

      return {
        content: [
          {
            type: "text" as const,
            text,
          },
        ],
        details: { name: skill.name },
      };
    },
  };
}
