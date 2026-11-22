import path from "node:path";
import { PRESET_AGENTS } from "@spherse/presets";
import { PROJECT_META_DIR } from "./types.js";
import type { ProjectStore } from "./store/project.js";
import type { FsPort } from "./store/fs-port.js";
import { type Logger, createSilentLogger } from "./logger.js";

export async function initPresets(
  projectStore: ProjectStore,
  fsPort: FsPort,
  logger: Logger = createSilentLogger(),
): Promise<void> {
  await fsPort.mkdirp(path.posix.join(PROJECT_META_DIR, "skills"));

  for (const agent of PRESET_AGENTS) {
    try {
      await projectStore.createAgent(agent.slugBase, agent.content);
      logger.info({ agent: agent.name }, "preset agent created");
    } catch (err) {
      logger.warn({ agent: agent.name, err }, "failed to create preset agent");
    }
  }
}
