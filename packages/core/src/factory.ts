import path from "node:path";
import { PROJECT_META_DIR } from "./types.js";
import { ProjectStore } from "./store/project.js";
import { SessionStore } from "./store/session.js";
import { AgentProfileStore } from "./store/agent-profile.js";
import { SkillStore } from "./store/skill.js";
import { Engine } from "./engine.js";
import type { Logger } from "./logger.js";

export async function createEngine(
  projectRoot: string,
  options?: { projectName?: string; defaultModel?: string; logger?: Logger },
): Promise<{ engine: Engine; projectStore: ProjectStore }> {
  const projectStore = new ProjectStore(projectRoot, options?.logger);
  try {
    await projectStore.open();
  } catch {
    const dirName = path.basename(path.resolve(projectRoot));
    await projectStore.create(
      options?.projectName ?? dirName,
      options?.defaultModel ?? "gemini-2.5-pro",
    );
  }

  const config = projectStore.getConfig()!;
  const profileStore = new AgentProfileStore(
    path.join(projectRoot, PROJECT_META_DIR, config.paths.agents),
  );

  const skillStore = new SkillStore(path.join(projectRoot, PROJECT_META_DIR, "skills"));

  const sessionStore = new SessionStore(options?.logger);
  await sessionStore.init(path.join(projectRoot, PROJECT_META_DIR, "sessions.db"));

  const engine = new Engine(profileStore, sessionStore, projectStore, skillStore, {
    defaultModel: options?.defaultModel,
    logger: options?.logger,
  });

  return { engine, projectStore };
}
