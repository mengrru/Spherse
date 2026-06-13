import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import type { ScheduleEntry, ScheduleLogEntry } from "../types.js";
import type { Logger } from "../logger.js";
import pino from "pino";
import { isPathInside } from "../utils/path-safety.js";

function findAgentDir(agentsDir: string, agentId: string): string | null {
  let entries: string[];
  try {
    entries = fs.readdirSync(agentsDir);
  } catch {
    return null;
  }
  for (const entry of entries) {
    const candidatePath = path.join(agentsDir, entry);
    try {
      const stat = fs.lstatSync(candidatePath);
      if (!stat.isDirectory()) continue;
      const realAgentsDir = fs.realpathSync(agentsDir);
      const realPath = fs.realpathSync(candidatePath);
      if (!isPathInside(realAgentsDir, realPath)) continue;
    } catch {
      continue;
    }
    const profilePath = path.join(candidatePath, "profile.md");
    try {
      const raw = fs.readFileSync(profilePath, "utf-8");
      const match = raw.match(/^id:\s*(\S+)/m);
      if (match && match[1] === agentId) return candidatePath;
    } catch {
      continue;
    }
  }
  return null;
}

export class ScheduleStore {
  private agentsDir: string;
  private logger: Logger;

  constructor(agentsDir: string, logger?: Logger) {
    this.agentsDir = agentsDir;
    this.logger = logger ?? pino({ level: "silent" });
  }

  private resolveAgentDir(agentId: string): string {
    const dir = findAgentDir(this.agentsDir, agentId);
    if (!dir) throw new Error(`agent directory not found for "${agentId}"`);
    return dir;
  }

  list(agentId: string): ScheduleEntry[] {
    const agentDir = this.resolveAgentDir(agentId);
    const filePath = path.join(agentDir, "schedules.yml");
    try {
      const raw = fs.readFileSync(filePath, "utf-8");
      if (!raw.trim()) return [];
      const parsed = YAML.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  get(agentId: string, scheduleId: string): ScheduleEntry | null {
    const entries = this.list(agentId);
    return entries.find((e) => e.id === scheduleId) ?? null;
  }

  saveAll(agentId: string, entries: ScheduleEntry[]): void {
    const agentDir = this.resolveAgentDir(agentId);
    const filePath = path.join(agentDir, "schedules.yml");
    if (entries.length === 0) {
      try { fs.unlinkSync(filePath); } catch { /* file may not exist */ }
      return;
    }
    const content = YAML.stringify(entries);
    fs.writeFileSync(filePath, content, "utf-8");
    this.logger.info({ agentId, count: entries.length }, "schedules saved");
  }

  create(agentId: string, entry: ScheduleEntry): void {
    const entries = this.list(agentId);
    entries.push(entry);
    this.saveAll(agentId, entries);
  }

  update(agentId: string, scheduleId: string, partial: Partial<ScheduleEntry>): ScheduleEntry | null {
    const entries = this.list(agentId);
    const idx = entries.findIndex((e) => e.id === scheduleId);
    if (idx === -1) return null;
    entries[idx] = { ...entries[idx], ...partial, updatedAt: Date.now() };
    this.saveAll(agentId, entries);
    return entries[idx];
  }

  delete(agentId: string, scheduleId: string): void {
    const entries = this.list(agentId).filter((e) => e.id !== scheduleId);
    this.saveAll(agentId, entries);
  }

  deleteAll(agentId: string): void {
    const agentDir = findAgentDir(this.agentsDir, agentId);
    if (!agentDir) return;
    try { fs.unlinkSync(path.join(agentDir, "schedules.yml")); } catch { /* file may not exist */ }
    try { fs.unlinkSync(path.join(agentDir, "schedule-logs.jsonl")); } catch { /* file may not exist */ }
    this.logger.info({ agentId }, "schedule files deleted");
  }

  private static MAX_LOG_LINES = 5000;

  appendLog(agentId: string, entry: ScheduleLogEntry): void {
    const agentDir = this.resolveAgentDir(agentId);
    const filePath = path.join(agentDir, "schedule-logs.jsonl");
    fs.appendFileSync(filePath, JSON.stringify(entry) + "\n", "utf-8");

    try {
      const stat = fs.statSync(filePath);
      if (stat.size > 1024 * 1024 * 2) {
        const raw = fs.readFileSync(filePath, "utf-8");
        const lines = raw.trim().split("\n").filter(Boolean);
        if (lines.length > ScheduleStore.MAX_LOG_LINES) {
          fs.writeFileSync(filePath, lines.slice(-ScheduleStore.MAX_LOG_LINES).join("\n") + "\n", "utf-8");
        }
      }
    } catch {
      /* best-effort rotation */
    }
  }

  getRecentLogs(agentId: string, limit: number = 50): ScheduleLogEntry[] {
    const agentDir = this.resolveAgentDir(agentId);
    const filePath = path.join(agentDir, "schedule-logs.jsonl");
    try {
      const raw = fs.readFileSync(filePath, "utf-8");
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
