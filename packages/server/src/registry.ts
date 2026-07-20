import path from "node:path";
import { nanoid } from "nanoid";
import { createProject } from "@spherse/core";
import type { ProjectRuntime, ProjectManager, SessionManager, TriggerManager, Logger, SamplingParams } from "@spherse/core";

export interface ProjectContext {
  runtime: ProjectRuntime;
  projectManager: ProjectManager;
  sessionRuntime: SessionManager;
  triggerManager: TriggerManager;
  projectId: string;
}

export interface ProjectInfo {
  id: string;
  name: string;
  rootPath: string;
}

export class ProjectRegistry {
  private projects = new Map<string, ProjectContext>();
  private pending = new Map<string, Promise<ProjectContext>>();
  private logger: Logger;
  private defaultModel?: string;
  private sampling?: SamplingParams;

  constructor(
    logger: Logger,
    options?: { defaultModel?: string; sampling?: SamplingParams },
  ) {
    this.logger = logger;
    this.defaultModel = options?.defaultModel;
    this.sampling = options?.sampling;
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
    const projectLogger = this.logger.child({ projectRoot: resolvedRoot });
    const runtime = await createProject(resolvedRoot, {
      defaultModel: this.defaultModel,
      sampling: this.sampling,
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
      triggerManager: runtime.triggerManager,
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

  listInfo(): ProjectInfo[] {
    const result: ProjectInfo[] = [];
    for (const [id, ctx] of this.projects) {
      const rootPath = ctx.projectManager.getRootPath();
      result.push({ id, name: path.basename(rootPath), rootPath });
    }
    return result;
  }

  getInfo(projectId: string): ProjectInfo | undefined {
    const ctx = this.projects.get(projectId);
    if (!ctx) return undefined;
    const rootPath = ctx.projectManager.getRootPath();
    return { id: projectId, name: path.basename(rootPath), rootPath };
  }

  async remove(projectId: string): Promise<void> {
    const ctx = this.projects.get(projectId);
    if (!ctx) return;
    await ctx.runtime.shutdown();
    this.projects.delete(projectId);
  }

  async removeAll(): Promise<void> {
    const ids = this.list();
    const results = await Promise.allSettled(ids.map((id) => this.remove(id)));
    for (const [i, result] of results.entries()) {
      if (result.status === "rejected") {
        this.logger.error({ projectId: ids[i], err: result.reason }, "failed to remove project");
      }
    }
  }

  setDefaultModel(model: string | undefined): void {
    this.defaultModel = model;
    for (const ctx of this.projects.values()) {
      try {
        ctx.sessionRuntime.setDefaultModel(model);
      } catch (err) {
        this.logger.error({ err }, "failed to update default model for project");
      }
    }
  }

  setSampling(sampling: SamplingParams | undefined): void {
    this.sampling = sampling;
    for (const ctx of this.projects.values()) {
      try {
        ctx.sessionRuntime.setSampling(sampling);
      } catch (err) {
        this.logger.error({ err }, "failed to update sampling for project");
      }
    }
  }
}
