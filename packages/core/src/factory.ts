import path from "node:path";
import { PROJECT_META_DIR } from "./types.js";
import { ProjectStore } from "./store/project.js";
import { Engine } from "./engine.js";
import { Scheduler } from "./scheduler.js";
import { initPresets } from "./presets.js";
import type { Logger } from "./logger.js";

export async function createEngine(
  projectRoot: string,
  options?: { projectName?: string; defaultModel?: string; logger?: Logger },
): Promise<{ engine: Engine; projectStore: ProjectStore; projectId: string }> {
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

  if (isNewProject) {
    const spherseDir = path.join(projectRoot, PROJECT_META_DIR);
    await initPresets(projectStore, spherseDir, options?.logger);
  }

  const engine = new Engine(projectStore, {
    defaultModel: options?.defaultModel,
    logger: options?.logger,
  });

  const scheduler = new Scheduler(engine, projectStore, options?.logger);
  engine.setScheduler(scheduler);
  await scheduler.loadFromAgents();

  return { engine, projectStore, projectId: projectStore.config.getProjectId() };
}
