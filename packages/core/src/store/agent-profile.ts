import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import matter from "gray-matter";
import type { AgentProfile, TimePerceptionConfig } from "../types.js";
import { ValidationError } from "../errors.js";

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

export class AgentProfileStore {
  private profilePath: string;
  private themePath: string;
  private slug: string;

  constructor(profilePath: string, slug: string) {
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
    await fs.mkdir(path.dirname(this.profilePath), { recursive: true });
    await fs.writeFile(this.profilePath, serialized, "utf-8");

    return this.parseFile().then((p) => p!);
  }

  private async readFrontmatter(): Promise<Record<string, unknown> | null> {
    try {
      const raw = await fs.readFile(this.profilePath, "utf-8");
      return matter(raw).data;
    } catch {
      return null;
    }
  }

  async getTheme(): Promise<string> {
    try {
      return await fs.readFile(this.themePath, "utf-8");
    } catch {
      return "";
    }
  }

  async saveTheme(content: string): Promise<void> {
    await fs.writeFile(this.themePath, content, "utf-8");
  }

  async getRawContent(): Promise<string> {
    return fs.readFile(this.profilePath, "utf-8");
  }

  private async parseFile(): Promise<AgentProfile | null> {
    try {
      const raw = await fs.readFile(this.profilePath, "utf-8");
      const { data, content } = matter(raw);

      if (!data.name) return null;

      if (!data.id) {
        data.id = crypto.randomUUID();
        await fs.writeFile(this.profilePath, matter.stringify(content, data), "utf-8");
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
        model: data.model,
        tools: data.tools,
        context: data.context,
        output: data.output,
        timePerception: parseTimePerception(data.timePerception),
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
