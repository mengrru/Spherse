import path from "node:path";
import { PROJECT_META_DIR } from "./types.js";
import { ProjectStore } from "./store/project.js";
import { SessionStore } from "./store/session.js";
import { AgentProfileStore } from "./store/agent-profile.js";
import { SkillStore } from "./store/skill.js";
import { Engine } from "./engine.js";
import { initPresets } from "./presets.js";
import type { Logger } from "./logger.js";

export async function createEngine(
  projectRoot: string,
  options?: { projectName?: string; defaultModel?: string; logger?: Logger },
): Promise<{ engine: Engine; projectStore: ProjectStore }> {
  const projectStore = new ProjectStore(projectRoot, options?.logger);
  let isNewProject = false;
  try {
    await projectStore.open();
  } catch {
    isNewProject = true;
    const dirName = path.basename(path.resolve(projectRoot));
    await projectStore.create(
      options?.projectName ?? dirName,
      options?.defaultModel ?? "gemini-2.5-pro",
    );
  }

  const config = projectStore.getConfig()!;
  const spherseDir = path.join(projectRoot, PROJECT_META_DIR);
  const agentsPath = path.join(spherseDir, config.paths.agents);
  const profileStore = new AgentProfileStore(agentsPath);

  const skillStore = new SkillStore(path.join(spherseDir, "skills"));

  if (isNewProject) {
    await initPresets(projectRoot, spherseDir, profileStore, options?.logger);
  }

  const sessionStore = new SessionStore(agentsPath, options?.logger);

  const engine = new Engine(profileStore, sessionStore, projectStore, skillStore, {
    defaultModel: options?.defaultModel,
    logger: options?.logger,
  });

  return { engine, projectStore };
}
