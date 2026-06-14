import path from "node:path";
import { nanoid } from "nanoid";
import { createProject } from "@spherse/core";
import type { ProjectRuntime, ProjectManager, SessionRuntime, Scheduler, Logger } from "@spherse/core";

export interface ProjectContext {
  runtime: ProjectRuntime;
  projectManager: ProjectManager;
  sessionRuntime: SessionRuntime;
  scheduler: Scheduler;
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
      if (ctx.projectManager.getRootPath() === resolvedRoot) {
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
    const projectLogger = this.logger.child({});
    const runtime = await createProject(resolvedRoot, {
      defaultModel: this.defaultModel,
      logger: projectLogger,
    });

    let projectId = runtime.projectId;
    if (this.projects.has(projectId)) {
      const newId = nanoid(8);
      await runtime.projectManager.regenerateProjectId(newId);
      this.logger.warn(
        { originalId: projectId, newId, projectRoot: resolvedRoot },
        "project id conflict, regenerated for duplicate directory",
      );
      projectId = newId;
    }

    const ctx: ProjectContext = {
      runtime,
      projectManager: runtime.projectManager,
      sessionRuntime: runtime.sessionRuntime,
      scheduler: runtime.scheduler,
      projectId,
    };
    this.projects.set(projectId, ctx);
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
    await ctx.runtime.shutdown();
    this.projects.delete(projectId);
  }

  async removeAll(): Promise<void> {
    const ids = this.list();
    await Promise.all(ids.map((id) => this.remove(id)));
  }

  setDefaultModel(model: string | undefined): void {
    this.defaultModel = model;
    for (const ctx of this.projects.values()) {
      ctx.sessionRuntime.setDefaultModel(model);
    }
  }
}
