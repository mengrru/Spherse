import fs from "node:fs/promises";
import path from "node:path";
import type { PathRule } from "../../kernel/ports.js";

export interface MemoryEntry {
  id: string;
  agentId: string;
  content: string;
  tags?: string[];
  createdAt: number;
}

export const MEMORY_FILE = "memory.jsonl";

export const MEMORY_PATH_RULE: PathRule = {
  match: /^\.spherse\/agents\/[^/]+\/memory\.jsonl$/,
  category: "memory",
  llm: { read: true, write: true },
};

function parseLine(line: string): MemoryEntry | null {
  try {
    const parsed = JSON.parse(line) as MemoryEntry;
    if (typeof parsed.id !== "string" || typeof parsed.content !== "string") return null;
    return parsed;
  } catch {
    return null;
  }
}

export function filterEntries(entries: ReadonlyArray<MemoryEntry>, query: string): MemoryEntry[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...entries];
  return entries.filter(
    (e) =>
      e.content.toLowerCase().includes(q) ||
      (e.tags ?? []).some((t) => t.toLowerCase().includes(q)),
  );
}

export class MemoryStore {
  private readonly filePath: string;
  private readonly agentId: string;
  private cache: MemoryEntry[] | null = null;

  constructor(agentDir: string, agentId: string) {
    this.filePath = path.join(agentDir, MEMORY_FILE);
    this.agentId = agentId;
  }

  private async readAll(): Promise<MemoryEntry[]> {
    if (this.cache) return this.cache;
    let text: string;
    try {
      text = await fs.readFile(this.filePath, "utf-8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        this.cache = [];
        return this.cache;
      }
      throw err;
    }
    this.cache = text
      .split("\n")
      .filter((l) => l.trim() !== "")
      .map(parseLine)
      .filter((e): e is MemoryEntry => e !== null);
    return this.cache;
  }

  async list(): Promise<MemoryEntry[]> {
    return [...(await this.readAll())];
  }

  async recall(query: string): Promise<MemoryEntry[]> {
    return filterEntries(await this.readAll(), query);
  }

  async save(content: string, tags?: string[]): Promise<MemoryEntry> {
    const entry: MemoryEntry = {
      id: crypto.randomUUID(),
      agentId: this.agentId,
      content,
      tags: tags && tags.length > 0 ? tags : undefined,
      createdAt: Date.now(),
    };
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    await fs.appendFile(this.filePath, JSON.stringify(entry) + "\n", "utf-8");
    if (this.cache) this.cache.push(entry);
    return entry;
  }

  clearCache(): void {
    this.cache = null;
  }
}

export function memoryStoreOf(agentDir: string, agentId: string): MemoryStore {
  return new MemoryStore(agentDir, agentId);
}
