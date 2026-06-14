import path from "node:path";
import { PROJECT_META_DIR } from "./types.js";
import { ProjectStore } from "./store/project.js";
import { ProjectManager } from "./project-manager.js";
import { SessionRuntime } from "./session-runtime.js";
import { Scheduler } from "./scheduler.js";
import { ProjectRuntime } from "./project-runtime.js";
import { initPresets } from "./presets.js";
import { type Logger, createSilentLogger } from "./logger.js";

export async function createProject(
  projectRoot: string,
  options?: { projectName?: string; defaultModel?: string; logger?: Logger },
): Promise<ProjectRuntime> {
  const logger = options?.logger ?? createSilentLogger();

  const projectStore = new ProjectStore(projectRoot, logger);

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
    await initPresets(projectStore, spherseDir, logger);
  }

  const projectManager = new ProjectManager(projectStore, logger);
  const sessionRuntime = new SessionRuntime(projectStore, {
    defaultModel: options?.defaultModel,
    logger,
  });
  const scheduler = new Scheduler(sessionRuntime, projectStore, logger);
  await scheduler.loadFromAgents();

  return new ProjectRuntime({
    projectManager,
    sessionRuntime,
    scheduler,
    projectId: projectStore.config.getProjectId(),
    logger,
  });
}
