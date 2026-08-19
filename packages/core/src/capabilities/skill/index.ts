import type { Capability } from "../../kernel/capability.js";
import type { ContextBlock } from "../../kernel/context-block.js";
import { createLoadSkillTool } from "../../tools/load-skill.js";
import type { SkillStore } from "../../store/skill.js";

function escapeAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function skillCapability(): Capability {
  return {
    id: "skill",
    tools: (host) => {
      const agentSkillStore = host.projectStore
        .getAgent(host.agentId)
        ?.skills as SkillStore | undefined;
      return [
        createLoadSkillTool(host.projectRoot, host.projectStore.skill, agentSkillStore),
      ];
    },
    contextBlocks: async (view) => {
      const globalSkills = await view.projectStore.skill.list();
      const byName = new Map<string, { name: string; description: string }>();
      for (const s of globalSkills) byName.set(s.name, { name: s.name, description: s.description });
      const agentSkillStore = view.projectStore.getAgent(view.agentId)?.skills as
        | SkillStore
        | undefined;
      if (agentSkillStore) {
        const agentSkills = await agentSkillStore.list();
        for (const s of agentSkills) byName.set(s.name, { name: s.name, description: s.description });
      }
      const skills = [...byName.values()];
      if (skills.length === 0) return [];
      const items = skills
        .map((s) => `<skill-item name="${escapeAttr(s.name)}" description="${escapeAttr(s.description)}"/>`)
        .join("\n");
      const block: ContextBlock = {
        kind: "skill-catalog",
        render: () => `<skill-catalog>\n${items}\n</skill-catalog>`,
      };
      return [block];
    },
  };
}
