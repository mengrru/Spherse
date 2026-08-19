import path from "node:path";
import { nanoid } from "nanoid";
import { createProject, ModelCatalog } from "@spherse/core";
import type { ProjectRuntime, ProjectManager, SessionManager, TriggerManager, Logger, SamplingParams } from "@spherse/core";

export interface ProjectContext {
  runtime: ProjectRuntime;
  projectId: string;
}

export type ProjectContextCompat = ProjectContext & {
  readonly projectManager: ProjectManager;
  readonly sessionRuntime: SessionManager;
  readonly triggerManager: TriggerManager;
};

export interface ProjectInfo {
  id: string;
  name: string;
  rootPath: string;
  lastOpened?: string;
}

export interface RegisterOptions {
  lastOpened?: string;
}

export class ProjectRegistry {
  private projects = new Map<string, ProjectContextCompat>();
  private pending = new Map<string, Promise<ProjectContextCompat>>();
  private lastOpenedMap = new Map<string, string>();
  private logger: Logger;
  private defaultModel?: string;
  private sampling?: SamplingParams;

  private readonly modelCatalog: ModelCatalog;

  getSupportedProviders() {
    return this.modelCatalog.getSupportedProviders();
  }

  constructor(
    logger: Logger,
    options?: { defaultModel?: string; sampling?: SamplingParams; modelCatalog?: ModelCatalog },
  ) {
    this.logger = logger;
    this.defaultModel = options?.defaultModel;
    this.sampling = options?.sampling;
    this.modelCatalog = options?.modelCatalog ?? new ModelCatalog();
  }

  async register(projectRoot: string, options?: RegisterOptions): Promise<ProjectContextCompat> {
    const resolvedRoot = path.resolve(projectRoot);

    for (const ctx of this.projects.values()) {
      if (ctx.runtime.projectManager.getRootPath() === resolvedRoot) {
        if (options?.lastOpened) {
          this.lastOpenedMap.set(ctx.projectId, options.lastOpened);
        }
        return ctx;
      }
    }

    const existing = this.pending.get(resolvedRoot);
    if (existing) return existing;

    const promise = this.doRegister(resolvedRoot, options);
    this.pending.set(resolvedRoot, promise);
    try {
      return await promise;
    } finally {
      this.pending.delete(resolvedRoot);
    }
  }

  private async doRegister(resolvedRoot: string, options?: RegisterOptions): Promise<ProjectContextCompat> {
    const projectLogger = this.logger.child({ projectRoot: resolvedRoot });
    const runtime = await createProject(resolvedRoot, {
      defaultModel: this.defaultModel,
      sampling: this.sampling,
      logger: projectLogger,
      ...(this.modelCatalog ? { modelCatalog: this.modelCatalog } : {}),
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

    const ctx: ProjectContextCompat = Object.freeze({
      runtime,
      projectId,
      get projectManager() {
        return runtime.projectManager;
      },
      get sessionRuntime() {
        return runtime.sessionRuntime;
      },
      get triggerManager() {
        return runtime.triggerManager;
      },
    });
    this.projects.set(projectId, ctx);
    if (options?.lastOpened) {
      this.lastOpenedMap.set(projectId, options.lastOpened);
    }
    return ctx;
  }

  get(projectId: string): ProjectContextCompat | undefined {
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
      const rootPath = ctx.runtime.projectManager.getRootPath();
      const lastOpened = this.lastOpenedMap.get(id);
      result.push({ id, name: path.basename(rootPath), rootPath, lastOpened });
    }
    result.sort((a, b) => {
      const ta = a.lastOpened ?? "";
      const tb = b.lastOpened ?? "";
      return tb.localeCompare(ta);
    });
    return result;
  }

  getInfo(projectId: string): ProjectInfo | undefined {
    const ctx = this.projects.get(projectId);
    if (!ctx) return undefined;
    const rootPath = ctx.runtime.projectManager.getRootPath();
    const lastOpened = this.lastOpenedMap.get(projectId);
    return { id: projectId, name: path.basename(rootPath), rootPath, lastOpened };
  }

  setLastOpened(projectId: string, lastOpened: string): void {
    if (!this.projects.has(projectId)) return;
    this.lastOpenedMap.set(projectId, lastOpened);
  }

  async remove(projectId: string): Promise<void> {
    const ctx = this.projects.get(projectId);
    if (!ctx) return;
    await ctx.runtime.shutdown();
    this.projects.delete(projectId);
    this.lastOpenedMap.delete(projectId);
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
        ctx.runtime.sessionRuntime.setDefaultModel(model);
      } catch (err) {
        this.logger.error({ err }, "failed to update default model for project");
      }
    }
  }

  setSampling(sampling: SamplingParams | undefined): void {
    this.sampling = sampling;
    for (const ctx of this.projects.values()) {
      try {
        ctx.runtime.sessionRuntime.setSampling(sampling);
      } catch (err) {
        this.logger.error({ err }, "failed to update sampling for project");
      }
    }
  }
}
