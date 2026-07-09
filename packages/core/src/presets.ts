import fs from "node:fs/promises";
import path from "node:path";
import { PRESET_AGENTS, AGENT_TEMPLATE } from "@spherse/presets";
import type { ProjectStore } from "./store/project.js";
import { type Logger, createSilentLogger } from "./logger.js";

export async function initPresets(
  projectStore: ProjectStore,
  spherseDir: string,
  logger: Logger = createSilentLogger(),
): Promise<void> {
  await fs.mkdir(path.join(spherseDir, "skills"), { recursive: true });

  for (const agent of PRESET_AGENTS) {
    try {
      const content = AGENT_TEMPLATE.replace(/^---\n/, `---\nname: ${agent.name}\n`);
      await projectStore.createAgent(agent.slugBase, content);
      logger.info({ agent: agent.name }, "preset agent created");
    } catch (err) {
      logger.warn({ agent: agent.name, err }, "failed to create preset agent");
    }
  }
}
