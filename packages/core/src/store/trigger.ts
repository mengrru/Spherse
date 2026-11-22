import path from "node:path";
import YAML from "yaml";
import type { TriggerEntry, TriggerLogEntry } from "../types.js";
import { type Logger, createSilentLogger } from "../logger.js";
import type { FsPort } from "./fs-port.js";

export class TriggerStore {
  private fsPort: FsPort;
  private relTriggersDir: string;
  private relTriggersPath: string;
  private relLogsPath: string;
  private logger: Logger;

  constructor(fsPort: FsPort, relAgentDir: string, logger?: Logger) {
    this.fsPort = fsPort;
    this.relTriggersDir = path.posix.join(relAgentDir, "triggers");
    this.relTriggersPath = path.posix.join(this.relTriggersDir, "index.yml");
    this.relLogsPath = path.posix.join(this.relTriggersDir, "logs.jsonl");
    this.logger = logger ?? createSilentLogger();
  }

  async list(): Promise<TriggerEntry[]> {
    let raw: string;
    try {
      raw = await this.fsPort.readFile(this.relTriggersPath);
    } catch {
      return [];
    }
    if (!raw.trim()) return [];
    try {
      const parsed = YAML.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  async get(triggerId: string): Promise<TriggerEntry | null> {
    const entries = await this.list();
    return entries.find((e) => e.id === triggerId) ?? null;
  }

  async saveAll(entries: TriggerEntry[]): Promise<void> {
    if (entries.length === 0) {
      await this.fsPort.unlink(this.relTriggersPath);
      return;
    }
    await this.fsPort.mkdirp(this.relTriggersDir);
    const content = YAML.stringify(entries);
    await this.fsPort.writeFile(this.relTriggersPath, content);
    this.logger.info({ count: entries.length }, "triggers saved");
  }

  async create(entry: TriggerEntry): Promise<void> {
    const entries = await this.list();
    entries.push(entry);
    await this.saveAll(entries);
  }

  async update(triggerId: string, partial: Partial<TriggerEntry>): Promise<TriggerEntry | null> {
    const entries = await this.list();
    const idx = entries.findIndex((e) => e.id === triggerId);
    if (idx === -1) return null;
    entries[idx] = { ...entries[idx], ...partial, updatedAt: Date.now() };
    await this.saveAll(entries);
    return entries[idx];
  }

  async delete(triggerId: string): Promise<void> {
    const entries = (await this.list()).filter((e) => e.id !== triggerId);
    await this.saveAll(entries);
  }

  async deleteAll(): Promise<void> {
    await this.fsPort.unlink(this.relTriggersPath);
    await this.fsPort.unlink(this.relLogsPath);
    await this.fsPort.rm(this.relTriggersDir, { recursive: true });
    this.logger.info("trigger files deleted");
  }

  private static MAX_LOG_LINES = 5000;

  async appendLog(entry: TriggerLogEntry): Promise<void> {
    await this.fsPort.mkdirp(this.relTriggersDir);
    await this.fsPort.appendFile(this.relLogsPath, JSON.stringify(entry) + "\n");

    try {
      const stat = await this.fsPort.stat(this.relLogsPath);
      if (stat && stat.size > 1024 * 1024 * 2) {
        const raw = await this.fsPort.readFile(this.relLogsPath);
        const lines = raw.trim().split("\n").filter(Boolean);
        if (lines.length > TriggerStore.MAX_LOG_LINES) {
          await this.fsPort.writeFile(this.relLogsPath, lines.slice(-TriggerStore.MAX_LOG_LINES).join("\n") + "\n");
        }
      }
    } catch {
      /* best-effort rotation */
    }
  }

  async getRecentLogs(limit: number = 50): Promise<TriggerLogEntry[]> {
    let raw: string;
    try {
      raw = await this.fsPort.readFile(this.relLogsPath);
    } catch {
      return [];
    }
    const lines = raw.trim().split("\n").filter(Boolean);
    const recent = lines.slice(-limit);
    return recent.map((line) => {
      try { return JSON.parse(line); } catch { return null; }
    }).filter(Boolean) as TriggerLogEntry[];
  }
}
