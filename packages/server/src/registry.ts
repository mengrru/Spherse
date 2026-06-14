import path from "node:path";
import { nanoid } from "nanoid";
import { createEngine, ProjectStore } from "@spherse/core";
import type { Engine, FileWriteMutex, Logger } from "@spherse/core";

export interface ProjectContext {
  engine: Engine;
  projectStore: ProjectStore;
  fileWriteMutex: FileWriteMutex;
  projectId: string;
}

export class ProjectRegistry {
  private projects = new Map<string, ProjectContext>();
  private pending = new Map<string, Promise<ProjectContext>>();
  private logger: Logger;
  private defaultModel?: string;

  constructor(logger: Logger, defaultModel?: string) {
    this.logger = logger;
    this.defaultModel = defaultModel;
  }

  async register(projectRoot: string): Promise<ProjectContext> {
    const resolvedRoot = path.resolve(projectRoot);

    for (const ctx of this.projects.values()) {
      if (ctx.projectStore.getRootPath() === resolvedRoot) {
        return ctx;
      }
    }

    const existing = this.pending.get(resolvedRoot);
    if (existing) return existing;

    const promise = this.doRegister(resolvedRoot);
    this.pending.set(resolvedRoot, promise);
    try {
      return await promise;
    } finally {
      this.pending.delete(resolvedRoot);
    }
  }

  private async doRegister(resolvedRoot: string): Promise<ProjectContext> {
    const tempStore = new ProjectStore(resolvedRoot, this.logger);
    let projectId: string;
    try {
      projectId = await tempStore.readProjectId();
    } catch {
      projectId = "(new-project)";
    }

    const projectLogger = this.logger.child({ projectId });
    const { engine, projectStore } = await createEngine(resolvedRoot, {
      defaultModel: this.defaultModel,
      logger: projectLogger,
    });
    projectId = projectStore.getProjectId();

    let resolvedId = projectId;
    if (this.projects.has(projectId)) {
      resolvedId = nanoid(8);
      await projectStore.regenerateProjectId(resolvedId);
      this.logger.warn(
        { originalId: projectId, newId: resolvedId, projectRoot: resolvedRoot },
        "project id conflict, regenerated for duplicate directory",
      );
    }

    const ctx: ProjectContext = {
      engine,
      projectStore,
      fileWriteMutex: engine.getFileWriteMutex(),
      projectId: resolvedId,
    };
    this.projects.set(resolvedId, ctx);
    return ctx;
  }

  get(projectId: string): ProjectContext | undefined {
    return this.projects.get(projectId);
  }

  has(projectId: string): boolean {
    return this.projects.has(projectId);
  }

  list(): string[] {
    return [...this.projects.keys()];
  }

  async remove(projectId: string): Promise<void> {
    const ctx = this.projects.get(projectId);
    if (!ctx) return;
    await ctx.engine.shutdown();
    this.projects.delete(projectId);
  }

  async removeAll(): Promise<void> {
    const ids = this.list();
    await Promise.all(ids.map((id) => this.remove(id)));
  }

  setDefaultModel(model: string | undefined): void {
    this.defaultModel = model;
    for (const ctx of this.projects.values()) {
      ctx.engine.setDefaultModel(model);
    }
  }
}
