import {
  ModelCatalog,
  OpfsFsPort,
  type Logger,
  type ProjectRuntime,
  type SamplingParams,
  type ThinkingLevel,
} from "@spherse/core";
import { assembleProjectCore } from "@spherse/core/assemble";
import type { RpcProjectContext, RpcProjectInfo } from "@spherse/rpc/host";
import type { SessionChangePayload } from "@spherse/core";
import { readOpfsJson, writeOpfsJson } from "./opfs-json.js";
import { LazyMemoryStore, LazySessionStore } from "./lazy-stores.js";

const REGISTRY_FILE = "spherse-registry.json";

interface RegistryEntry {
  id: string;
  name: string;
  dirName: string;
  createdAt: number;
  lastOpened: string;
}

interface RegistryFile {
  projects: RegistryEntry[];
}

interface RuntimeRecord {
  runtime: ProjectRuntime;
  entry: RegistryEntry;
}

function sanitizeName(name: string): string {
  const sanitized = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return sanitized.length > 0 ? sanitized : "project";
}

function toProjectContext(record: RuntimeRecord): RpcProjectContext {
  const { runtime } = record;
  return {
    runtime,
    projectManager: runtime.projectManager,
    sessionRuntime: runtime.sessionRuntime,
    triggerManager: runtime.triggerManager,
  };
}

export class BrowserProjectRegistry {
  private entries: RegistryEntry[] = [];
  private readonly runtimes = new Map<string, RuntimeRecord>();
  private readonly pendingOpens = new Map<string, Promise<RuntimeRecord>>();
  private readonly removing = new Map<string, Promise<void>>();
  private readonly pendingStoreLoads = new Set<Promise<unknown>>();
  private readonly logger: Logger;
  private readonly catalog: ModelCatalog;
  private defaultModel?: string;
  private sampling?: SamplingParams;
  private thinkingLevel?: ThinkingLevel;

  private constructor(logger: Logger, catalog: ModelCatalog) {
    this.logger = logger;
    this.catalog = catalog;
  }

  static async open(logger: Logger, catalog: ModelCatalog): Promise<BrowserProjectRegistry> {
    const registry = new BrowserProjectRegistry(logger, catalog);
    const file = await readOpfsJson<RegistryFile>(REGISTRY_FILE, { projects: [] });
    registry.entries = Array.isArray(file.projects) ? file.projects : [];
    return registry;
  }

  getSupportedProviders(): unknown {
    return this.catalog.getSupportedProviders();
  }

  private async persist(): Promise<void> {
    await writeOpfsJson(REGISTRY_FILE, { projects: this.entries });
  }

  private trackStoreLoad(promise: Promise<unknown>): void {
    this.pendingStoreLoads.add(promise);
    const release = () => this.pendingStoreLoads.delete(promise);
    promise.then(release, release);
  }

  async storesReady(): Promise<void> {
    while (this.pendingStoreLoads.size > 0) {
      await Promise.all([...this.pendingStoreLoads]);
    }
  }

  private dirNameFor(name: string): string {
    const base = sanitizeName(name);
    const taken = new Set(this.entries.map((entry) => entry.dirName));
    if (!taken.has(base)) return base;
    for (let i = 2; ; i += 1) {
      const candidate = `${base}-${i}`;
      if (!taken.has(candidate)) return candidate;
    }
  }

  async create(name: string): Promise<string> {
    const trimmed = name.trim();
    if (trimmed.length === 0) throw new Error("project name is required");
    const existingByName = this.entries.find((entry) => entry.name === trimmed);
    if (existingByName) {
      const record = await this.ensureRuntime(existingByName);
      return record.entry.id;
    }
    const dirName = this.dirNameFor(trimmed);
    const entry: RegistryEntry = {
      id: "",
      name: trimmed,
      dirName,
      createdAt: Date.now(),
      lastOpened: new Date().toISOString(),
    };
    const record = await this.ensureRuntime(entry);
    this.entries.push(record.entry);
    await this.persist();
    return record.entry.id;
  }

  private ensureRuntime(entry: RegistryEntry): Promise<RuntimeRecord> {
    const existing = this.runtimes.get(entry.id);
    if (existing && entry.id !== "") {
      existing.entry.lastOpened = new Date().toISOString();
      return Promise.resolve(existing);
    }
    const pending = this.pendingOpens.get(entry.dirName);
    if (pending) return pending;
    const removal = this.removing.get(entry.dirName);
    const openPromise = removal ? removal.then(() => this.doOpen(entry)) : this.doOpen(entry);
    const tracked = openPromise.then(
      (record) => {
        this.pendingOpens.delete(entry.dirName);
        return record;
      },
      (err) => {
        this.pendingOpens.delete(entry.dirName);
        throw err;
      },
    );
    this.pendingOpens.set(entry.dirName, tracked);
    return tracked;
  }

  private async doOpen(entry: RegistryEntry): Promise<RuntimeRecord> {
    const fsPort = await OpfsFsPort.open(`projects/${entry.dirName}`);
    const projectRoot = `/projects/${entry.dirName}`;
    const storeKeyPrefix = `projects/${entry.dirName}`;
    const sessionStores = new Map<string, LazySessionStore>();
    const memoryStores = new Map<string, LazyMemoryStore>();
    const storeKeyOf = (agentDir: string): string => `${storeKeyPrefix}${agentDir.slice(projectRoot.length)}`;
    const sessionStoreFor = (storeKey: string, agentId: string, onSessionChange?: (payload: SessionChangePayload) => void): LazySessionStore => {
      let store = sessionStores.get(storeKey);
      if (!store) {
        store = new LazySessionStore(storeKey, agentId, this.logger, onSessionChange);
        sessionStores.set(storeKey, store);
        this.trackStoreLoad(store.ready);
      }
      return store;
    };
    const memoryStoreFor = (storeKey: string): LazyMemoryStore => {
      let store = memoryStores.get(storeKey);
      if (!store) {
        store = new LazyMemoryStore(storeKey, fsPort, this.logger);
        memoryStores.set(storeKey, store);
        this.trackStoreLoad(store.ready);
      }
      return store;
    };
    const runtime = await assembleProjectCore(projectRoot, {
      projectName: entry.name,
      ...(this.defaultModel !== undefined ? { defaultModel: this.defaultModel } : {}),
      ...(this.sampling !== undefined ? { sampling: this.sampling } : {}),
      ...(this.thinkingLevel !== undefined ? { thinkingLevel: this.thinkingLevel } : {}),
      logger: this.logger,
      modelCatalog: this.catalog,
      storage: {
        fsPort,
        sessionStoreFactory: (ctx) =>
          sessionStoreFor(storeKeyOf(ctx.agentDir), ctx.agentId, ctx.onSessionChange),
        memoryStoreFactory: (ctx) => memoryStoreFor(storeKeyOf(ctx.agentDir)),
      },
    });

    let projectId = runtime.projectId;
    if (this.runtimes.has(projectId)) {
      const newId = crypto.randomUUID().replace(/-/g, "").slice(0, 8);
      await runtime.projectManager.regenerateProjectId(newId);
      this.logger.warn({ originalId: projectId, newId }, "project id conflict, regenerated");
      projectId = newId;
    }

    const record: RuntimeRecord = { runtime, entry: { ...entry, id: projectId } };
    this.runtimes.set(projectId, record);

    const prewarmAgentStores = (agentId: string, slug: string): void => {
      const agentDir = `${projectRoot}/.spherse/agents/${slug}`;
      sessionStoreFor(storeKeyOf(agentDir), agentId);
      memoryStoreFor(storeKeyOf(agentDir));
    };

    runtime.projectManager.onAgentChange((payload) => {
      if (payload.action === "created" || payload.action === "updated") {
        const profile = runtime.projectManager.getAgentProfile(payload.agentId);
        if (profile) prewarmAgentStores(profile.id, profile.slug);
      }
    });

    for (const agent of runtime.projectManager.listAgents()) {
      prewarmAgentStores(agent.id, agent.slug);
    }
    await this.storesReady();
    runtime.projectManager.listProjectSessions(1);
    await Promise.all(
      runtime.projectManager.listAgents().map((agent) =>
        runtime.projectManager.getAgentMemory(agent.id).catch((err) =>
          this.logger.warn({ err, agentId: agent.id }, "memory store warmup failed"),
        ),
      ),
    );

    record.entry.lastOpened = new Date().toISOString();
    const persistedIndex = this.entries.findIndex((candidate) => candidate.id === projectId);
    if (persistedIndex >= 0) {
      this.entries[persistedIndex] = record.entry;
      await this.persist();
    }
    return record;
  }

  get(projectId: string): RpcProjectContext | undefined {
    const record = this.runtimes.get(projectId);
    return record ? toProjectContext(record) : undefined;
  }

  has(projectId: string): boolean {
    return this.runtimes.has(projectId);
  }

  list(): string[] {
    return [...this.runtimes.keys()];
  }

  listInfo(): RpcProjectInfo[] {
    return this.entries
      .map((entry) => ({
        id: entry.id,
        name: entry.name,
        rootPath: `/projects/${entry.dirName}`,
        lastOpened: entry.lastOpened,
      }))
      .sort((a, b) => (b.lastOpened ?? "").localeCompare(a.lastOpened ?? ""));
  }

  getInfo(projectId: string): RpcProjectInfo | undefined {
    const entry = this.entries.find((candidate) => candidate.id === projectId);
    if (!entry) return undefined;
    return {
      id: entry.id,
      name: entry.name,
      rootPath: `/projects/${entry.dirName}`,
      lastOpened: entry.lastOpened,
    };
  }

  async remove(projectId: string): Promise<void> {
    const record = this.runtimes.get(projectId);
    if (!record) {
      this.entries = this.entries.filter((entry) => entry.id !== projectId);
      await this.persist();
      return;
    }
    const existing = this.removing.get(record.entry.dirName);
    if (existing) return existing;
    let releaseBarrier!: () => void;
    const barrier = new Promise<void>((resolve) => {
      releaseBarrier = resolve;
    });
    this.removing.set(record.entry.dirName, barrier);
    try {
      this.runtimes.delete(projectId);
      this.entries = this.entries.filter((entry) => entry.id !== projectId);
      await this.persist();
      await record.runtime.shutdown();
    } finally {
      releaseBarrier();
      if (this.removing.get(record.entry.dirName) === barrier) {
        this.removing.delete(record.entry.dirName);
      }
    }
  }

  async removeAll(): Promise<void> {
    const ids = this.list();
    const results = await Promise.allSettled(ids.map((id) => this.remove(id)));
    for (const [index, result] of results.entries()) {
      if (result.status === "rejected") {
        this.logger.error({ projectId: ids[index], err: result.reason }, "failed to remove project");
      }
    }
  }

  setDefaultModel(model: string | undefined): void {
    this.defaultModel = model;
    for (const record of this.runtimes.values()) {
      try {
        record.runtime.sessionRuntime.setDefaultModel(model);
      } catch (err) {
        this.logger.error({ err }, "failed to update default model for project");
      }
    }
  }

  setSampling(sampling: SamplingParams | undefined): void {
    this.sampling = sampling;
    for (const record of this.runtimes.values()) {
      try {
        record.runtime.sessionRuntime.setSampling(sampling);
      } catch (err) {
        this.logger.error({ err }, "failed to update sampling for project");
      }
    }
  }

  setThinkingLevel(thinkingLevel: ThinkingLevel | undefined): void {
    this.thinkingLevel = thinkingLevel;
    for (const record of this.runtimes.values()) {
      try {
        record.runtime.sessionRuntime.setThinkingLevel(thinkingLevel);
      } catch (err) {
        this.logger.error({ err }, "failed to update thinking level for project");
      }
    }
  }
}
