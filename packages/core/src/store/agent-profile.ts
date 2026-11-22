import path from "node:path";
import crypto from "node:crypto";
import matter from "gray-matter";
import type { AgentMemoryConfig, AgentProfile, ThinkingLevel, TimePerceptionConfig } from "../types.js";
import { ValidationError } from "../errors.js";
import type { FsPort } from "./fs-port.js";

const THINKING_LEVELS: readonly ThinkingLevel[] = ["off", "low", "medium", "high"];

function posixDirname(rel: string): string {
  const idx = rel.lastIndexOf("/");
  return idx === -1 ? "" : rel.slice(0, idx);
}

function parseThinkingLevel(raw: unknown): ThinkingLevel | undefined {
  return typeof raw === "string" && THINKING_LEVELS.includes(raw as ThinkingLevel)
    ? (raw as ThinkingLevel)
    : undefined;
}

function parseTimePerception(raw: unknown): TimePerceptionConfig | undefined {
  if (raw == null || typeof raw !== "object") return undefined;
  const obj = raw as Record<string, unknown>;
  const enabled = obj.enabled === true;
  const epochMs = typeof obj.epochMs === "number" ? obj.epochMs : undefined;
  const startMs = typeof obj.startMs === "number" ? obj.startMs : undefined;
  const flowRate = typeof obj.flowRate === "number" ? obj.flowRate : undefined;

  if (!enabled && epochMs === undefined && startMs === undefined && flowRate === undefined) {
    return undefined;
  }

  return {
    enabled,
    epochMs: epochMs ?? Date.now(),
    startMs: startMs ?? epochMs ?? Date.now(),
    flowRate: flowRate ?? 1,
    timeZone: typeof obj.timeZone === "string" ? obj.timeZone : undefined,
  };
}

function parseMemoryConfig(raw: unknown): AgentMemoryConfig | undefined {
  if (raw == null || typeof raw !== "object") return undefined;
  const obj = raw as Record<string, unknown>;
  if (typeof obj.enabled !== "boolean") return undefined;
  return { enabled: obj.enabled };
}

export class AgentProfileStore {
  private fsPort: FsPort;
  private relProfilePath: string;
  private relThemePath: string;
  private profilePath: string;
  private themePath: string;
  private slug: string;

  constructor(fsPort: FsPort, relProfilePath: string, profilePath: string, slug: string) {
    this.fsPort = fsPort;
    this.relProfilePath = relProfilePath;
    this.relThemePath = path.posix.join(posixDirname(relProfilePath), "theme.css");
    this.profilePath = profilePath;
    this.themePath = path.join(path.dirname(profilePath), "theme.css");
    this.slug = slug;
  }

  async read(): Promise<AgentProfile | null> {
    return this.parseFile();
  }

  async save(content: string): Promise<AgentProfile> {
    const { data, content: body } = matter(content);
    if (typeof data.name !== "string") {
      throw new ValidationError("agent profile name is required");
    }

    const existingData = await this.readFrontmatter();
    if (existingData?.id) {
      data.id = existingData.id;
    }
    if (typeof existingData?.createdAt === "number") {
      data.createdAt = existingData.createdAt;
    } else if (typeof data.createdAt !== "number") {
      data.createdAt = Date.now();
    }
    if (!data.id) {
      data.id = crypto.randomUUID();
    }

    const serialized = matter.stringify(body, data);
    await this.fsPort.mkdirp(posixDirname(this.relProfilePath));
    await this.fsPort.writeFile(this.relProfilePath, serialized);

    return this.parseFile().then((p) => p!);
  }

  getProfilePath(): string {
    return this.profilePath;
  }

  private async readFrontmatter(): Promise<Record<string, unknown> | null> {
    try {
      const raw = await this.fsPort.readFile(this.relProfilePath);
      return matter(raw).data;
    } catch {
      return null;
    }
  }

  async getTheme(): Promise<string> {
    try {
      return await this.fsPort.readFile(this.relThemePath);
    } catch {
      return "";
    }
  }

  async saveTheme(content: string): Promise<void> {
    await this.fsPort.writeFile(this.relThemePath, content);
  }

  async getRawContent(): Promise<string> {
    return this.fsPort.readFile(this.relProfilePath);
  }

  private async parseFile(): Promise<AgentProfile | null> {
    try {
      const raw = await this.fsPort.readFile(this.relProfilePath);
      const { data, content } = matter(raw);

      if (!data.name) return null;

      if (!data.id) {
        data.id = crypto.randomUUID();
        await this.fsPort.writeFile(this.relProfilePath, matter.stringify(content, data));
      }

      return {
        id: data.id,
        name: data.name,
        alias:
          typeof data.alias === "string" && data.alias.trim()
            ? data.alias
            : undefined,
        slug: this.slug,
        createdAt: data.createdAt,
        model: typeof data.model === "string" && data.model.trim() ? data.model : undefined,
        thinkingLevel: parseThinkingLevel(data.thinkingLevel),
        tools: data.tools,
        context: data.context,
        quickLinks: Array.isArray(data.quickLinks)
          ? data.quickLinks.filter((p): p is string => typeof p === "string")
          : undefined,
        output: data.output,
        timePerception: parseTimePerception(data.timePerception),
        memory: parseMemoryConfig(data.memory),
        yolo: data.yolo === true || undefined,
        systemPrompt: content.trim(),
        filePath: this.profilePath,
      };
    } catch {
      return null;
    }
  }
}

export function assertSafeSlug(slug: string): void {
  if (
    !slug.trim() ||
    slug !== slug.trim() ||
    slug.includes("..") ||
    slug.includes("/") ||
    slug.includes("\\")
  ) {
    throw new ValidationError("invalid agent slug");
  }
}
