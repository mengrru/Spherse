import { EventEmitter } from "node:events";
import { CronExpressionParser } from "cron-parser";
import type { Engine } from "./engine.js";
import type { ScheduleEntry, ScheduleLogEntry } from "./types.js";
import { ScheduleStore } from "./store/schedule.js";
import type { Logger } from "./logger.js";
import pino from "pino";

export interface ScheduleEventPayload {
  agentId: string;
  scheduleId: string;
  sessionId?: string;
  triggeredAt?: number;
  status?: string;
  error?: string;
  schedule?: ScheduleEntry;
}

function getNextCronDate(cron: string): Date | null {
  try {
    const expression = CronExpressionParser.parse(cron);
    return expression.next().toDate();
  } catch {
    return null;
  }
}

const TEMPLATE_VARS: Record<string, () => string> = {
  date: () => new Date().toISOString().slice(0, 10),
  time: () => new Date().toTimeString().slice(0, 5),
  datetime: () => `${new Date().toISOString().slice(0, 10)} ${new Date().toTimeString().slice(0, 5)}`,
  weekday: () => new Intl.DateTimeFormat("zh-CN", { weekday: "long" }).format(new Date()),
  agent_name: () => "",
};

export class Scheduler extends EventEmitter {
  private engine: Engine;
  private scheduleStore: ScheduleStore;
  private entries: Map<string, ScheduleEntry> = new Map();
  private agentSchedules: Map<string, Set<string>> = new Map();
  private scheduleAgentMap: Map<string, string> = new Map();
  private agentNames: Map<string, string> = new Map();
  private nextTriggerMap: Map<string, number> = new Map();
  private inProgress: Set<string> = new Set();
  private pollTimer: NodeJS.Timeout | null = null;
  private logger: Logger;
  private static POLL_INTERVAL = 10 * 60 * 1000;

  constructor(engine: Engine, agentsDir: string, logger?: Logger) {
    super();
    this.engine = engine;
    this.scheduleStore = new ScheduleStore(agentsDir, logger);
    this.logger = logger ?? pino({ level: "silent" });
    this.startPolling();
  }

  private startPolling(): void {
    const now = Date.now();
    const msToNext = Scheduler.POLL_INTERVAL - (now % Scheduler.POLL_INTERVAL);
    this.scheduleNextPoll(msToNext);
  }

  private scheduleNextPoll(delay: number): void {
    this.pollTimer = setTimeout(() => {
      this.tick();
      this.scheduleNextPoll(Scheduler.POLL_INTERVAL);
    }, delay);
    this.pollTimer.unref();
  }

  private stopPolling(): void {
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
  }

  private recomputeNextTrigger(scheduleId: string, cron: string): void {
    const nextDate = getNextCronDate(cron);
    this.nextTriggerMap.set(scheduleId, nextDate ? nextDate.getTime() : 0);
  }

  private tick(): void {
    const now = Date.now();
    for (const [id, entry] of this.entries) {
      if (!entry.enabled) continue;
      if (this.inProgress.has(id)) continue;
      const nextAt = this.nextTriggerMap.get(id) ?? 0;
      if (nextAt > 0 && nextAt <= now) {
        this.recomputeNextTrigger(id, entry.cron);
        this.inProgress.add(id);
        void this.trigger(entry).finally(() => this.inProgress.delete(id));
      }
    }
  }

  async loadFromProfiles(): Promise<void> {
    const profiles = await this.engine.listProfiles();
    for (const profile of profiles) {
      this.agentNames.set(profile.id, profile.name);
      const entries = this.scheduleStore.list(profile.id);
      for (const entry of entries) {
        this.register(profile.id, entry, false);
      }
    }
    this.logger.info({ count: this.entries.size }, "scheduler loaded");
  }

  register(agentId: string, entry: ScheduleEntry, persist: boolean = true): void {
    this.entries.set(entry.id, entry);
    this.scheduleAgentMap.set(entry.id, agentId);

    let scheduleSet = this.agentSchedules.get(agentId);
    if (!scheduleSet) {
      scheduleSet = new Set();
      this.agentSchedules.set(agentId, scheduleSet);
    }
    scheduleSet.add(entry.id);

    if (persist) {
      this.scheduleStore.create(agentId, entry);
    }

    this.recomputeNextTrigger(entry.id, entry.cron);

    this.logger.info({ agentId, scheduleId: entry.id }, "schedule registered");
  }

  unregister(agentId: string, scheduleId: string): void {
    if (this.scheduleAgentMap.get(scheduleId) !== agentId) return;
    this.entries.delete(scheduleId);
    this.scheduleAgentMap.delete(scheduleId);
    this.nextTriggerMap.delete(scheduleId);
    this.inProgress.delete(scheduleId);
    this.agentSchedules.get(agentId)?.delete(scheduleId);
    this.scheduleStore.delete(agentId, scheduleId);
    this.logger.info({ agentId, scheduleId }, "schedule unregistered");
  }

  unregisterAgent(agentId: string): void {
    const scheduleIds = this.agentSchedules.get(agentId);
    if (!scheduleIds) return;
    for (const scheduleId of scheduleIds) {
      this.entries.delete(scheduleId);
      this.scheduleAgentMap.delete(scheduleId);
      this.nextTriggerMap.delete(scheduleId);
      this.inProgress.delete(scheduleId);
    }
    this.agentSchedules.delete(agentId);
    this.agentNames.delete(agentId);
    this.scheduleStore.deleteAll(agentId);
    this.logger.info({ agentId }, "agent schedules unregistered");
  }

  update(agentId: string, scheduleId: string, partial: Partial<ScheduleEntry>): ScheduleEntry | null {
    if (this.scheduleAgentMap.get(scheduleId) !== agentId) return null;
    const existing = this.entries.get(scheduleId);
    if (!existing) return null;

    const updated = { ...existing, ...partial, updatedAt: Date.now() };
    this.entries.set(scheduleId, updated);
    this.scheduleStore.update(agentId, scheduleId, updated);

    const cronChanged = partial.cron !== undefined && partial.cron !== existing.cron;
    const becameEnabled = !existing.enabled && partial.enabled === true;
    if (cronChanged || becameEnabled) {
      this.recomputeNextTrigger(scheduleId, updated.cron);
    }

    this.emit("schedule_updated", { agentId, scheduleId, schedule: updated });
    return updated;
  }

  list(agentId: string): ScheduleEntry[] {
    const scheduleIds = this.agentSchedules.get(agentId);
    if (!scheduleIds) return [];
    return Array.from(scheduleIds)
      .map((id) => this.entries.get(id))
      .filter(Boolean) as ScheduleEntry[];
  }

  get(agentId: string, scheduleId: string): ScheduleEntry | null {
    const runtimeAgentId = this.scheduleAgentMap.get(scheduleId);
    if (runtimeAgentId !== undefined) return runtimeAgentId === agentId ? this.entries.get(scheduleId) ?? null : null;
    return this.scheduleStore.get(agentId, scheduleId);
  }

  getNextTrigger(agentId: string, scheduleId: string): Date | null {
    if (this.scheduleAgentMap.get(scheduleId) !== agentId) return null;
    const entry = this.entries.get(scheduleId);
    if (!entry || !entry.enabled) return null;
    const ts = this.nextTriggerMap.get(scheduleId);
    return ts && ts > 0 ? new Date(ts) : null;
  }

  getRecentLogs(agentId: string, limit?: number): ScheduleLogEntry[] {
    return this.scheduleStore.getRecentLogs(agentId, limit);
  }

  stopAll(): void {
    this.stopPolling();
    this.inProgress.clear();
    this.logger.info("scheduler stopped");
  }

  triggerNow(agentId: string, scheduleId: string): ScheduleEntry | null {
    if (this.scheduleAgentMap.get(scheduleId) !== agentId) return null;
    const entry = this.entries.get(scheduleId);
    if (!entry) return null;
    if (this.inProgress.has(scheduleId)) return entry;
    this.recomputeNextTrigger(scheduleId, entry.cron);
    this.inProgress.add(scheduleId);
    void this.trigger(entry).finally(() => this.inProgress.delete(scheduleId));
    return entry;
  }

  private resolveTemplate(entry: ScheduleEntry): string {
    const agentId = this.scheduleAgentMap.get(entry.id);
    const agentName = agentId ? this.agentNames.get(agentId) ?? "" : "";

    return entry.message.replace(/{{(\w+)}}/g, (_match, key) => {
      if (key === "agent_name") return agentName;
      const fn = TEMPLATE_VARS[key];
      return fn ? fn() : `{{${key}}}`;
    });
  }

  private async trigger(entry: ScheduleEntry): Promise<void> {
    const agentId = this.scheduleAgentMap.get(entry.id);
    if (!agentId) return;

    const now = Date.now();
    const agentName = this.agentNames.get(agentId) ?? "";
    const logEntry: ScheduleLogEntry = {
      scheduleId: entry.id,
      scheduleName: entry.name || entry.cron,
      agentName,
      sessionId: "",
      triggeredAt: now,
      status: "running",
    };

    this.emit("schedule_triggered", { agentId, scheduleId: entry.id, triggeredAt: now });

    try {
      let sessionId: string;

      if (entry.mode === "new_session") {
        sessionId = await this.engine.createSession(agentId, "scheduled");
      } else if (entry.targetSessionId) {
        sessionId = entry.targetSessionId;
        await this.engine.restoreSession(agentId, sessionId);
      } else {
        this.logger.error({ scheduleId: entry.id }, "existing_session mode but no targetSessionId");
        return;
      }

      logEntry.sessionId = sessionId;
      this.scheduleStore.appendLog(agentId, logEntry);

      const resolvedMessage = this.resolveTemplate(entry);

      await this.engine.sendMessage(sessionId, resolvedMessage, (event) => {
        if (event.type === "agent_end") {
          this.scheduleStore.appendLog(agentId, {
            ...logEntry,
            completedAt: Date.now(),
            status: "success",
          });
          this.emit("schedule_completed", {
            agentId,
            scheduleId: entry.id,
            sessionId,
            status: "success",
          });
        }
      });
    } catch (err) {
      this.scheduleStore.appendLog(agentId, {
        ...logEntry,
        completedAt: Date.now(),
        status: "failed",
        error: String(err),
      });
      this.emit("schedule_failed", {
        agentId,
        scheduleId: entry.id,
        error: String(err),
      });
    }
  }
}
