import { ValidationError } from "../errors.js";

export interface MemoryEntry {
  id: string;
  content: string;
  tags?: string[];
  kind: string;
  source?: string;
  createdAt: number;
  updatedAt: number;
}

export interface MemoryEntryPatch {
  content?: string;
  tags?: string[];
}

export const MEMORY_DIR = "memory";
export const CORE_FILE = "core.md";
export const DB_FILE = "memory.db";
export const MAX_CORE_CHARS = 4000;
export const MAX_ENTRY_CONTENT_CHARS = 2000;
export const MAX_TAGS = 8;
export const MAX_TAG_CHARS = 24;
export const RECALL_LIMIT = 8;
export const LIST_LIMIT = 200;
export const SEARCH_LIMIT = 50;

export interface MemoryStorePort {
  close(): void;
  getCore(): Promise<string>;
  saveCore(content: string): Promise<void>;
  appendCore(content: string): Promise<string>;
  count(): number;
  list(limit?: number): MemoryEntry[];
  save(content: string, tags?: string[]): MemoryEntry;
  update(id: string, patch: MemoryEntryPatch): MemoryEntry;
  deleteEntry(id: string): void;
  search(query: string, limit?: number): MemoryEntry[];
}

export function normalizeTags(tags: string[] | undefined): string[] | undefined {
  if (!tags || tags.length === 0) return undefined;
  const cleaned = [...new Set(tags.map((t) => t.trim()).filter((t) => t.length > 0))];
  if (cleaned.length === 0) return undefined;
  if (cleaned.length > MAX_TAGS) {
    throw new ValidationError(`memory tags allow at most ${MAX_TAGS} entries`);
  }
  for (const tag of cleaned) {
    if (tag.length > MAX_TAG_CHARS) {
      throw new ValidationError(`memory tag exceeds ${MAX_TAG_CHARS} characters`);
    }
  }
  return cleaned;
}
