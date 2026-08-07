import { EventEmitter } from "node:events";
import { CronExpressionParser } from "cron-parser";
import type { SessionManager } from "../session/session-manager.js";
import type { ProjectStore } from "../store/project.js";
import type { TriggerStore } from "../store/trigger.js";
import type { TriggerEntry, TriggerLogEntry } from "../types.js";
import { type Logger, createSilentLogger } from "../logger.js";
import { resolveTemplateVars } from "./template.js";

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

function getNextCronDate(cron: string): Date | null {
  try {
    const expression = CronExpressionParser.parse(cron);
    return expression.next().toDate();
  } catch {
    return null;
  }
}

interface TriggerStateItem {
  cron: string;
  nextFire: number;
}

interface TriggerRef {
  agentId: string;
  agentName: string;
  entry: TriggerEntry;
}

export class TriggerManager extends EventEmitter {
  private sessionRuntime: SessionManager;
  private projectStore: ProjectStore;
  private logger: Logger;
  private inProgress: Set<string> = new Set();
  private triggerState: Map<string, TriggerStateItem> = new Map();

  constructor(deps: {
    sessionRuntime: SessionManager;
    projectStore: ProjectStore;
    logger?: Logger;
  }) {
    super();
    this.sessionRuntime = deps.sessionRuntime;
    this.projectStore = deps.projectStore;
    this.logger = deps.logger ?? createSilentLogger();
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

  private gcTriggerState(refs: TriggerRef[]): void {
    const diskIds = new Set(refs.map((r) => r.entry.id));
    for (const id of this.triggerState.keys()) {
      if (!diskIds.has(id)) this.triggerState.delete(id);
    }
  }

  private ensureTriggerState(id: string, cron: string): TriggerStateItem {
    let state = this.triggerState.get(id);
    if (!state || state.cron !== cron) {
      const nextDate = getNextCronDate(cron);
      state = { cron, nextFire: nextDate ? nextDate.getTime() : 0 };
      this.triggerState.set(id, state);
    }
    return state;
  }

  onTimeTick(): void {
    const now = Date.now();
    const allTriggers = this.readAllTriggers();
    this.gcTriggerState(allTriggers);

    for (const { agentId, agentName, entry } of allTriggers) {
      if (entry.type !== "time" || !entry.enabled || !entry.cron) continue;
      if (this.inProgress.has(entry.id)) continue;

      const state = this.ensureTriggerState(entry.id, entry.cron);
      if (state.nextFire > 0 && state.nextFire <= now) {
        const nextDate = getNextCronDate(entry.cron);
        state.nextFire = nextDate ? nextDate.getTime() : 0;

        this.inProgress.add(entry.id);
        void this.fire(entry, agentId, agentName, "").finally(() => {
          this.inProgress.delete(entry.id);
        });
      }
    }
  }

  onUserEvent(eventName: string, payload: string): number {
    if (eventName.startsWith("sp:")) return 0;

    let fired = 0;
    const allTriggers = this.readAllTriggers();
    for (const { agentId, agentName, entry } of allTriggers) {
      if (entry.type !== "event" || !entry.enabled || !entry.eventName) continue;
      if (this.inProgress.has(entry.id)) continue;
      if (entry.eventName !== eventName) continue;

      this.inProgress.add(entry.id);
      fired++;
      void this.fire(entry, agentId, agentName, payload, eventName).finally(() => {
        this.inProgress.delete(entry.id);
      });
    }
    return fired;
  }

  list(agentId: string): TriggerEntry[] {
    return this.getTriggerStore(agentId)?.list() ?? [];
  }

  get(agentId: string, triggerId: string): TriggerEntry | null {
    return this.getTriggerStore(agentId)?.get(triggerId) ?? null;
  }

  create(agentId: string, entry: TriggerEntry): void {
    this.getTriggerStore(agentId)?.create(entry);
    this.emit("trigger_updated", { agentId, triggerId: entry.id, trigger: entry });
  }

  update(agentId: string, triggerId: string, partial: Partial<TriggerEntry>): TriggerEntry | null {
    const store = this.getTriggerStore(agentId);
    if (!store) return null;
    const updated = store.update(triggerId, partial);
    if (updated) {
      if (updated.type === "time" && updated.cron) {
        const nextDate = getNextCronDate(updated.cron);
        this.triggerState.set(triggerId, {
          cron: updated.cron,
          nextFire: nextDate ? nextDate.getTime() : 0,
        });
      } else {
        this.triggerState.delete(triggerId);
      }
      this.emit("trigger_updated", { agentId, triggerId, trigger: updated });
    }
    return updated;
  }

  delete(agentId: string, triggerId: string): void {
    this.getTriggerStore(agentId)?.delete(triggerId);
    this.triggerState.delete(triggerId);
    this.emit("trigger_updated", { agentId, triggerId });
  }

  deleteAllForAgent(agentId: string): void {
    const store = this.getTriggerStore(agentId);
    const entries = store?.list() ?? [];
    for (const entry of entries) {
      this.triggerState.delete(entry.id);
    }
    store?.deleteAll();
    this.logger.info({ agentId }, "agent triggers deleted");
  }

  getNextTrigger(agentId: string, triggerId: string): Date | null {
    const entry = this.get(agentId, triggerId);
    if (!entry || !entry.enabled || entry.type !== "time" || !entry.cron) return null;
    const nextDate = getNextCronDate(entry.cron);
    return nextDate;
  }

  getRecentLogs(agentId: string, limit?: number): TriggerLogEntry[] {
    return this.getTriggerStore(agentId)?.getRecentLogs(limit) ?? [];
  }

  stopAll(): void {
    this.inProgress.clear();
    this.logger.info("trigger manager stopped");
  }

  runNow(agentId: string, triggerId: string): TriggerEntry | null {
    const entry = this.get(agentId, triggerId);
    if (!entry) return null;
    if (this.inProgress.has(triggerId)) return entry;
    if (entry.type === "time" && entry.cron) {
      const nextDate = getNextCronDate(entry.cron);
      this.triggerState.set(triggerId, {
        cron: entry.cron,
        nextFire: nextDate ? nextDate.getTime() : 0,
      });
    }
    const agentStore = this.projectStore.getAgent(agentId);
    const agentName = agentStore?.getProfile().name ?? "";
    this.inProgress.add(triggerId);
    void this.fire(entry, agentId, agentName, "").finally(() => {
      this.inProgress.delete(triggerId);
    });
    return entry;
  }

  private async fire(
    entry: TriggerEntry,
    agentId: string,
    agentName: string,
    payload: string,
    eventName?: string,
  ): Promise<void> {
    const now = Date.now();
    const triggerName = entry.name || (entry.type === "time" ? entry.cron! : entry.eventName!);

    const logEntry: TriggerLogEntry = {
      triggerId: entry.id,
      triggerName,
      agentName,
      eventName,
      sessionId: "",
      triggeredAt: now,
      status: "running",
    };

    this.emit("trigger_triggered", { agentId, triggerId: entry.id, eventName, triggeredAt: now });

    try {
      let sessionId: string;

      if (entry.mode === "new_session") {
        sessionId = await this.sessionRuntime.createSession(agentId, "triggered");
      } else if (entry.targetSessionId) {
        sessionId = entry.targetSessionId;
        await this.sessionRuntime.restoreSession(agentId, sessionId);
      } else {
        const err = "existing_session mode but no targetSessionId";
        this.logger.error({ triggerId: entry.id }, err);
        throw new Error(err);
      }

      logEntry.sessionId = sessionId;
      this.getTriggerStore(agentId)?.appendLog(logEntry);

      const resolvedMessage = resolveTemplateVars(entry.message, { agentName, payload });

      await this.sessionRuntime.sendMessage(sessionId, resolvedMessage, [], (event) => {
        if (event.type === "agent_end") {
          this.getTriggerStore(agentId)?.appendLog({
            ...logEntry,
            completedAt: Date.now(),
            status: "success",
          });
          this.emit("trigger_completed", {
            agentId,
            triggerId: entry.id,
            sessionId,
            status: "success",
          });
        }
      });
    } catch (err) {
      this.getTriggerStore(agentId)?.appendLog({
        ...logEntry,
        completedAt: Date.now(),
        status: "failed",
        error: String(err),
      });
      this.emit("trigger_failed", {
        agentId,
        triggerId: entry.id,
        error: String(err),
      });
    }
  }
}
