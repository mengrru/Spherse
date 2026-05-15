import path from "node:path";
import { ProjectStore } from "./store/project.js";
import { SessionStore } from "./store/session.js";
import { AgentProfileStore } from "./store/agent-profile.js";
import { SkillStore } from "./store/skill.js";
import { Engine } from "./engine.js";

export async function createEngine(
  projectRoot: string,
  options?: { projectName?: string; defaultModel?: string },
): Promise<{ engine: Engine; projectStore: ProjectStore }> {
  const projectStore = new ProjectStore(projectRoot);
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
    path.join(projectRoot, ".pi", config.paths.agents),
  );

  const skillStore = new SkillStore(path.join(projectRoot, ".pi", "skills"));

  const sessionStore = new SessionStore();
  await sessionStore.init(path.join(projectRoot, ".pi", "sessions.db"));

  const engine = new Engine(profileStore, sessionStore, projectStore, skillStore, {
    defaultModel: options?.defaultModel,
  });

  return { engine, projectStore };
}
