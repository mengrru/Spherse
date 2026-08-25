import { EventEmitter } from "node:events";
import type { SessionPort } from "../kernel/ports.js";
import type { ProjectStore } from "../store/project.js";
import type { TriggerStore } from "../store/trigger.js";
import type { TriggerEntry, TriggerLogEntry } from "../types.js";
import { type Logger, createSilentLogger } from "../logger.js";
import { TriggerScheduler, getNextCronDate, type TriggerRef } from "./scheduler.js";
import { TriggerExecutor } from "./executor.js";

export interface TriggerEventPayload {
  agentId: string;
  triggerId: string;
  eventName?: string;
  sessionId?: string;
  triggeredAt?: number;
  status?: string;
  error?: string;
  trigger?: TriggerEntry;
}

export class TriggerManager extends EventEmitter {
  private readonly projectStore: ProjectStore;
  private readonly logger: Logger;
  private readonly scheduler: TriggerScheduler;
  private readonly executor: TriggerExecutor;

  constructor(deps: {
    sessionRuntime: SessionPort;
    projectStore: ProjectStore;
    logger?: Logger;
  }) {
    super();
    this.projectStore = deps.projectStore;
    this.logger = deps.logger ?? createSilentLogger();
    this.executor = new TriggerExecutor({
      session: deps.sessionRuntime,
      getTriggerStore: (agentId) => this.getTriggerStore(agentId),
      logger: this.logger,
    });
    this.executor.on("trigger_triggered", (payload) => this.emit("trigger_triggered", payload));
    this.executor.on("trigger_completed", (payload) => this.emit("trigger_completed", payload));
    this.executor.on("trigger_failed", (payload) => this.emit("trigger_failed", payload));
    this.scheduler = new TriggerScheduler({
      readAll: () => this.readAllTriggers(),
      onDue: (ref) => {
        void this.executor.fire(ref.entry, ref.agentId, ref.agentName, "");
      },
      isRunning: (triggerId) => this.executor.isRunning(triggerId),
    });
  }

  private getTriggerStore(agentId: string): TriggerStore | null {
    const agentStore = this.projectStore.getAgent(agentId);
    return agentStore ? agentStore.triggers : null;
  }

  private readAllTriggers(): TriggerRef[] {
    const result: TriggerRef[] = [];
    for (const [agentId, agentStore] of this.projectStore.agents) {
      const profile = agentStore.getProfile();
      const entries = agentStore.triggers.list();
      for (const entry of entries) {
        result.push({ agentId, agentName: profile.name, entry });
      }
    }
    return result;
  }

  onTimeTick(): void {
    this.scheduler.onTimeTick();
  }

  onUserEvent(eventName: string, payload: string): number {
    if (eventName.startsWith("sp:")) return 0;

    let fired = 0;
    for (const { agentId, agentName, entry } of this.readAllTriggers()) {
      if (entry.type !== "event" || !entry.enabled || !entry.eventName) continue;
      if (entry.eventName !== eventName) continue;
      if (this.executor.isRunning(entry.id)) continue;

      fired++;
      void this.executor.fire(entry, agentId, agentName, payload, eventName);
    }
    return fired;
  }

  list(agentId: string): TriggerEntry[] {
    return this.getTriggerStore(agentId)?.list() ?? [];
  }

  listProject(): { agentId: string; entry: TriggerEntry; nextTriggerAt: Date | null }[] {
    const result: { agentId: string; entry: TriggerEntry; nextTriggerAt: Date | null }[] = [];
    for (const { agentId, entry } of this.readAllTriggers()) {
      const next =
        entry.enabled && entry.type === "time" && entry.cron
          ? getNextCronDate(entry.cron)
          : null;
      result.push({ agentId, entry, nextTriggerAt: next });
    }
    return result;
  }

  get(agentId: string, triggerId: string): TriggerEntry | null {
    return this.getTriggerStore(agentId)?.get(triggerId) ?? null;
  }

  create(agentId: string, entry: TriggerEntry): void {
    this.getTriggerStore(agentId)?.create(entry);
    this.emit("trigger_updated", { agentId, triggerId: entry.id, trigger: entry });
  }

  update(agentId: string, triggerId: string, partial: Partial<TriggerEntry>): TriggerEntry | null {
    const updated = this.getTriggerStore(agentId)?.update(triggerId, partial) ?? null;
    if (updated) {
      if (updated.type === "time" && updated.cron) {
        this.scheduler.markFired(triggerId, updated.cron);
      } else {
        this.scheduler.invalidate(triggerId);
      }
      this.emit("trigger_updated", { agentId, triggerId, trigger: updated });
    }
    return updated;
  }

  delete(agentId: string, triggerId: string): void {
    this.getTriggerStore(agentId)?.delete(triggerId);
    this.scheduler.invalidate(triggerId);
    this.emit("trigger_updated", { agentId, triggerId });
  }

  deleteAllForAgent(agentId: string): void {
    const store = this.getTriggerStore(agentId);
    for (const entry of store?.list() ?? []) {
      this.scheduler.invalidate(entry.id);
    }
    store?.deleteAll();
    this.logger.info({ agentId }, "agent triggers deleted");
  }

  getNextTrigger(agentId: string, triggerId: string): Date | null {
    const entry = this.get(agentId, triggerId);
    if (!entry || !entry.enabled || entry.type !== "time" || !entry.cron) return null;
    return getNextCronDate(entry.cron);
  }

  getRecentLogs(agentId: string, limit?: number): TriggerLogEntry[] {
    return this.getTriggerStore(agentId)?.getRecentLogs(limit) ?? [];
  }

  stopAll(): void {
    this.executor.forgetAll();
    this.logger.info("trigger manager stopped");
  }

  runNow(agentId: string, triggerId: string): TriggerEntry | null {
    const entry = this.get(agentId, triggerId);
    if (!entry) return null;
    if (this.executor.isRunning(triggerId)) return entry;
    if (entry.type === "time" && entry.cron) {
      this.scheduler.markFired(triggerId, entry.cron);
    }
    const agentStore = this.projectStore.getAgent(agentId);
    const agentName = agentStore?.getProfile().name ?? "";
    void this.executor.fire(entry, agentId, agentName, "");
    return entry;
  }
}
