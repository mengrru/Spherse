import { EventEmitter } from "node:events";
import { CronExpressionParser } from "cron-parser";
import type { SessionManager } from "./session/session-manager.js";
import type { ProjectStore } from "./store/project.js";
import type { ScheduleStore } from "./store/schedule.js";
import type { ScheduleEntry, ScheduleLogEntry } from "./types.js";
import { type Logger, createSilentLogger } from "./logger.js";

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

function localDate(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function localTime(): string {
  const d = new Date();
  const h = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  return `${h}:${min}`;
}

const TEMPLATE_VARS: Record<string, () => string> = {
  date: localDate,
  time: localTime,
  datetime: () => `${localDate()} ${localTime()}`,
  weekday: () => new Intl.DateTimeFormat("zh-CN", { weekday: "long" }).format(new Date()),
  agent_name: () => "",
};

export function resolveTemplateVars(message: string, agentName: string): string {
  return message.replace(/{{(\w+)}}/g, (_match, key) => {
    if (key === "agent_name") return agentName;
    const fn = TEMPLATE_VARS[key];
    return fn ? fn() : `{{${key}}}`;
  });
}

export class Scheduler extends EventEmitter {
  private sessionRuntime: SessionManager;
  private projectStore: ProjectStore;
  private entries: Map<string, ScheduleEntry> = new Map();
  private agentSchedules: Map<string, Set<string>> = new Map();
  private scheduleAgentMap: Map<string, string> = new Map();
  private agentNames: Map<string, string> = new Map();
  private nextTriggerMap: Map<string, number> = new Map();
  private inProgress: Set<string> = new Set();
  private pollTimer: NodeJS.Timeout | null = null;
  private logger: Logger;
  private static POLL_INTERVAL = 10 * 60 * 1000;

  constructor(sessionRuntime: SessionManager, projectStore: ProjectStore, logger?: Logger) {
    super();
    this.sessionRuntime = sessionRuntime;
    this.projectStore = projectStore;
    this.logger = logger ?? createSilentLogger();
    this.startPolling();
  }

  private getScheduleStore(agentId: string): ScheduleStore | null {
    const agentStore = this.projectStore.getAgent(agentId);
    return agentStore ? agentStore.schedules : null;
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

  async loadFromAgents(): Promise<void> {
    for (const [agentId, agentStore] of this.projectStore.agents) {
      const profile = agentStore.getProfile();
      this.agentNames.set(agentId, profile.name);
      const entries = agentStore.schedules.list();
      for (const entry of entries) {
        this.register(agentId, entry, false);
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
      this.getScheduleStore(agentId)?.create(entry);
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
    this.getScheduleStore(agentId)?.delete(scheduleId);
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
    this.getScheduleStore(agentId)?.deleteAll();
    this.logger.info({ agentId }, "agent schedules unregistered");
  }

  update(agentId: string, scheduleId: string, partial: Partial<ScheduleEntry>): ScheduleEntry | null {
    if (this.scheduleAgentMap.get(scheduleId) !== agentId) return null;
    const existing = this.entries.get(scheduleId);
    if (!existing) return null;

    const updated = { ...existing, ...partial, updatedAt: Date.now() };
    this.entries.set(scheduleId, updated);
    this.getScheduleStore(agentId)?.update(scheduleId, updated);

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
    return this.getScheduleStore(agentId)?.get(scheduleId) ?? null;
  }

  getNextTrigger(agentId: string, scheduleId: string): Date | null {
    if (this.scheduleAgentMap.get(scheduleId) !== agentId) return null;
    const entry = this.entries.get(scheduleId);
    if (!entry || !entry.enabled) return null;
    const ts = this.nextTriggerMap.get(scheduleId);
    return ts && ts > 0 ? new Date(ts) : null;
  }

  getRecentLogs(agentId: string, limit?: number): ScheduleLogEntry[] {
    return this.getScheduleStore(agentId)?.getRecentLogs(limit) ?? [];
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

    return resolveTemplateVars(entry.message, agentName);
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
        sessionId = await this.sessionRuntime.createSession(agentId, "scheduled");
      } else if (entry.targetSessionId) {
        sessionId = entry.targetSessionId;
        await this.sessionRuntime.restoreSession(agentId, sessionId);
      } else {
        this.logger.error({ scheduleId: entry.id }, "existing_session mode but no targetSessionId");
        return;
      }

      logEntry.sessionId = sessionId;
      this.getScheduleStore(agentId)?.appendLog(logEntry);

      const resolvedMessage = this.resolveTemplate(entry);

      await this.sessionRuntime.sendMessage(sessionId, resolvedMessage, (event) => {
        if (event.type === "agent_end") {
          this.getScheduleStore(agentId)?.appendLog({
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
      this.getScheduleStore(agentId)?.appendLog({
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
