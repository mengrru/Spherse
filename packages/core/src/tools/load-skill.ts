import { Type } from "@sinclair/typebox";
import type { AgentTool } from "@mariozechner/pi-agent-core";
import { SkillStore } from "../store/skill.js";

const LoadSkillParams = Type.Object({
  skill_name: Type.String({ description: "Name of the skill to load" }),
});

export function createLoadSkillTool(skillDir: string): AgentTool<typeof LoadSkillParams> {
  const store = new SkillStore(skillDir);

  return {
    name: "load_skill",
    label: "Load Skill",
    description:
      "Load a skill's full instructions. Use this when you want to activate a skill from the available skills list.",
    parameters: LoadSkillParams,
    async execute(_toolCallId, params, _signal) {
      const skill = await store.get(params.skill_name);
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

      return {
        content: [
          {
            type: "text" as const,
            text: `# Skill: ${skill.name}\n\n${skill.instructions}`,
          },
        ],
        details: { name: skill.name },
      };
    },
  };
}
