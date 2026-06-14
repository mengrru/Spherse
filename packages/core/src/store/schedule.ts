import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import type { ScheduleEntry, ScheduleLogEntry } from "../types.js";
import { type Logger, createSilentLogger } from "../logger.js";

export class ScheduleStore {
  private schedulesPath: string;
  private logsPath: string;
  private logger: Logger;

  constructor(agentDir: string, logger?: Logger) {
    this.schedulesPath = path.join(agentDir, "schedules.yml");
    this.logsPath = path.join(agentDir, "schedule-logs.jsonl");
    this.logger = logger ?? createSilentLogger();
  }

  list(): ScheduleEntry[] {
    try {
      const raw = fs.readFileSync(this.schedulesPath, "utf-8");
      if (!raw.trim()) return [];
      const parsed = YAML.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  get(scheduleId: string): ScheduleEntry | null {
    const entries = this.list();
    return entries.find((e) => e.id === scheduleId) ?? null;
  }

  saveAll(entries: ScheduleEntry[]): void {
    if (entries.length === 0) {
      try { fs.unlinkSync(this.schedulesPath); } catch { /* file may not exist */ }
      return;
    }
    const content = YAML.stringify(entries);
    fs.writeFileSync(this.schedulesPath, content, "utf-8");
    this.logger.info({ count: entries.length }, "schedules saved");
  }

  create(entry: ScheduleEntry): void {
    const entries = this.list();
    entries.push(entry);
    this.saveAll(entries);
  }

  update(scheduleId: string, partial: Partial<ScheduleEntry>): ScheduleEntry | null {
    const entries = this.list();
    const idx = entries.findIndex((e) => e.id === scheduleId);
    if (idx === -1) return null;
    entries[idx] = { ...entries[idx], ...partial, updatedAt: Date.now() };
    this.saveAll(entries);
    return entries[idx];
  }

  delete(scheduleId: string): void {
    const entries = this.list().filter((e) => e.id !== scheduleId);
    this.saveAll(entries);
  }

  deleteAll(): void {
    try { fs.unlinkSync(this.schedulesPath); } catch { /* file may not exist */ }
    try { fs.unlinkSync(this.logsPath); } catch { /* file may not exist */ }
    this.logger.info("schedule files deleted");
  }

  private static MAX_LOG_LINES = 5000;

  appendLog(entry: ScheduleLogEntry): void {
    fs.appendFileSync(this.logsPath, JSON.stringify(entry) + "\n", "utf-8");

    try {
      const stat = fs.statSync(this.logsPath);
      if (stat.size > 1024 * 1024 * 2) {
        const raw = fs.readFileSync(this.logsPath, "utf-8");
        const lines = raw.trim().split("\n").filter(Boolean);
        if (lines.length > ScheduleStore.MAX_LOG_LINES) {
          fs.writeFileSync(this.logsPath, lines.slice(-ScheduleStore.MAX_LOG_LINES).join("\n") + "\n", "utf-8");
        }
      }
    } catch {
      /* best-effort rotation */
    }
  }

  getRecentLogs(limit: number = 50): ScheduleLogEntry[] {
    try {
      const raw = fs.readFileSync(this.logsPath, "utf-8");
      const lines = raw.trim().split("\n").filter(Boolean);
      const recent = lines.slice(-limit);
      return recent.map((line) => {
        try { return JSON.parse(line); } catch { return null; }
      }).filter(Boolean) as ScheduleLogEntry[];
    } catch {
      return [];
    }
  }
}
