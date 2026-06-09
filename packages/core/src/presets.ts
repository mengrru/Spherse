import fs from "node:fs/promises";
import path from "node:path";
import { PRESET_SKILL_SOURCES, PRESET_AGENTS, AGENT_TEMPLATE } from "@spherse/presets";
import type { AgentProfileStore } from "./store/agent-profile.js";
import type { Logger } from "./logger.js";

export async function initPresets(
  projectRoot: string,
  spherseDir: string,
  profileStore: AgentProfileStore,
  logger?: Logger,
): Promise<void> {
  for (const skill of PRESET_SKILL_SOURCES) {
    try {
      const skillDir = path.join(spherseDir, "skills", skill.dir);
      for (const file of skill.files) {
        const filePath = path.join(skillDir, file.relativePath);
        await fs.mkdir(path.dirname(filePath), { recursive: true });
        await fs.writeFile(filePath, file.content, "utf-8");
      }
      logger?.info({ skill: skill.dir }, "preset skill copied");
    } catch (err) {
      logger?.warn({ skill: skill.dir, err }, "failed to copy preset skill");
    }
  }

  for (const agent of PRESET_AGENTS) {
    try {
      const content = AGENT_TEMPLATE.replace("name: 新 Agent", `name: ${agent.name}`);
      await profileStore.save(agent.slug, content);
      logger?.info({ agent: agent.name }, "preset agent created");
    } catch (err) {
      logger?.warn({ agent: agent.name, err }, "failed to create preset agent");
    }
  }
}
