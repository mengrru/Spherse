import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import type { TriggerEntry, TriggerLogEntry } from "../types.js";
import { type Logger, createSilentLogger } from "../logger.js";

export class TriggerStore {
  private triggersDir: string;
  private triggersPath: string;
  private logsPath: string;
  private logger: Logger;

  constructor(agentDir: string, logger?: Logger) {
    this.triggersDir = path.join(agentDir, "triggers");
    this.triggersPath = path.join(this.triggersDir, "index.yml");
    this.logsPath = path.join(this.triggersDir, "logs.jsonl");
    this.logger = logger ?? createSilentLogger();
  }

  list(): TriggerEntry[] {
    try {
      const raw = fs.readFileSync(this.triggersPath, "utf-8");
      if (!raw.trim()) return [];
      const parsed = YAML.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  get(triggerId: string): TriggerEntry | null {
    const entries = this.list();
    return entries.find((e) => e.id === triggerId) ?? null;
  }

  saveAll(entries: TriggerEntry[]): void {
    if (entries.length === 0) {
      try { fs.unlinkSync(this.triggersPath); } catch { /* file may not exist */ }
      return;
    }
    fs.mkdirSync(this.triggersDir, { recursive: true });
    const content = YAML.stringify(entries);
    fs.writeFileSync(this.triggersPath, content, "utf-8");
    this.logger.info({ count: entries.length }, "triggers saved");
  }

  create(entry: TriggerEntry): void {
    const entries = this.list();
    entries.push(entry);
    this.saveAll(entries);
  }

  update(triggerId: string, partial: Partial<TriggerEntry>): TriggerEntry | null {
    const entries = this.list();
    const idx = entries.findIndex((e) => e.id === triggerId);
    if (idx === -1) return null;
    entries[idx] = { ...entries[idx], ...partial, updatedAt: Date.now() };
    this.saveAll(entries);
    return entries[idx];
  }

  delete(triggerId: string): void {
    const entries = this.list().filter((e) => e.id !== triggerId);
    this.saveAll(entries);
  }

  deleteAll(): void {
    try { fs.unlinkSync(this.triggersPath); } catch { /* file may not exist */ }
    try { fs.unlinkSync(this.logsPath); } catch { /* file may not exist */ }
    try { fs.rmdirSync(this.triggersDir); } catch { /* dir may not exist or not empty */ }
    this.logger.info("trigger files deleted");
  }

  private static MAX_LOG_LINES = 5000;

  appendLog(entry: TriggerLogEntry): void {
    fs.mkdirSync(this.triggersDir, { recursive: true });
    fs.appendFileSync(this.logsPath, JSON.stringify(entry) + "\n", "utf-8");

    try {
      const stat = fs.statSync(this.logsPath);
      if (stat.size > 1024 * 1024 * 2) {
        const raw = fs.readFileSync(this.logsPath, "utf-8");
        const lines = raw.trim().split("\n").filter(Boolean);
        if (lines.length > TriggerStore.MAX_LOG_LINES) {
          fs.writeFileSync(this.logsPath, lines.slice(-TriggerStore.MAX_LOG_LINES).join("\n") + "\n", "utf-8");
        }
      }
    } catch {
      /* best-effort rotation */
    }
  }

  getRecentLogs(limit: number = 50): TriggerLogEntry[] {
    try {
      const raw = fs.readFileSync(this.logsPath, "utf-8");
      const lines = raw.trim().split("\n").filter(Boolean);
      const recent = lines.slice(-limit);
      return recent.map((line) => {
        try { return JSON.parse(line); } catch { return null; }
      }).filter(Boolean) as TriggerLogEntry[];
    } catch {
      return [];
    }
  }
}
