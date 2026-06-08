import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import matter from "gray-matter";
import type { AgentProfile } from "../types.js";

const PROFILE_FILENAME = "profile.md";

function assertSafeSlug(slug: string): void {
  if (
    !slug.trim() ||
    slug !== slug.trim() ||
    slug.includes("..") ||
    slug.includes("/") ||
    slug.includes("\\")
  ) {
    throw new Error("invalid agent slug");
  }
}

export class AgentProfileStore {
  private agentDir: string;

  constructor(agentDir: string) {
    this.agentDir = agentDir;
  }

  async list(): Promise<AgentProfile[]> {
    try {
      const entries = await fs.readdir(this.agentDir, { withFileTypes: true });
      const dirs = entries.filter((e) => e.isDirectory());

      const profiles = await Promise.all(
        dirs.map((d) => {
          const profilePath = path.join(this.agentDir, d.name, PROFILE_FILENAME);
          return this.parseFile(profilePath, d.name);
        }),
      );
      return profiles.filter((p) => p !== null) as AgentProfile[];
    } catch {
      return [];
    }
  }

  async getById(id: string): Promise<AgentProfile | null> {
    const profiles = await this.list();
    return profiles.find((p) => p.id === id) ?? null;
  }

  async getByName(name: string): Promise<AgentProfile | null> {
    const profiles = await this.list();
    return profiles.find((p) => p.name === name) ?? null;
  }

  async save(slug: string, content: string): Promise<AgentProfile> {
    assertSafeSlug(slug);

    const { data, content: body } = matter(content);
    if (typeof data.name !== "string") {
      throw new Error("agent profile name is required");
    }

    const existingPath = path.join(this.agentDir, slug, PROFILE_FILENAME);
    const existingData = await this.readFrontmatter(existingPath);

    if (existingData?.id) {
      data.id = existingData.id;
    }
    if (typeof existingData?.createdAt === "number") {
      data.createdAt = existingData.createdAt;
    } else if (typeof data.createdAt !== "number") {
      data.createdAt = Date.now();
    }

    const generatedId = !data.id;
    if (generatedId) {
      data.id = crypto.randomUUID();
    }

    let dirName = slug;
    let filePath = existingData ? existingPath : "";
    for (let attempt = 0; !existingData; attempt += 1) {
      if (attempt > 10) throw new Error("agent slug collision");
      const shortId = (data.id as string).slice(0, 6);
      dirName = `${slug}-${shortId}`;
      filePath = path.join(this.agentDir, dirName, PROFILE_FILENAME);

      const collidingData = await this.readFrontmatter(filePath);
      if (!collidingData || collidingData.id === data.id) break;
      if (!generatedId) throw new Error("agent slug collision");
      data.id = crypto.randomUUID();
    }

    const dirPath = path.dirname(filePath);

    const serialized = matter.stringify(body, data);
    await fs.mkdir(dirPath, { recursive: true });
    await fs.writeFile(filePath, serialized, "utf-8");

    return this.parseFile(filePath, dirName).then((p) => p!);
  }

  private async readFrontmatter(filePath: string): Promise<Record<string, unknown> | null> {
    try {
      const raw = await fs.readFile(filePath, "utf-8");
      return matter(raw).data;
    } catch {
      return null;
    }
  }

  async getTheme(id: string): Promise<string> {
    const profiles = await this.list();
    const profile = profiles.find((p) => p.id === id);
    if (!profile) return "";
    const themePath = path.join(path.dirname(profile.filePath), "theme.css");
    try {
      return await fs.readFile(themePath, "utf-8");
    } catch {
      return "";
    }
  }

  async saveTheme(id: string, content: string): Promise<void> {
    const profiles = await this.list();
    const profile = profiles.find((p) => p.id === id);
    if (!profile) throw new Error("agent not found");
    const themePath = path.join(path.dirname(profile.filePath), "theme.css");
    await fs.writeFile(themePath, content, "utf-8");
  }

  async getRawContent(id: string): Promise<string | null> {
    const profiles = await this.list();
    const profile = profiles.find((p) => p.id === id);
    if (!profile) return null;
    return fs.readFile(profile.filePath, "utf-8");
  }

  async delete(id: string): Promise<void> {
    const profiles = await this.list();
    const profile = profiles.find((p) => p.id === id);
    if (profile) {
      const dirPath = path.dirname(profile.filePath);
      await fs.rm(dirPath, { recursive: true, force: true });
    }
  }

  private async parseFile(
    filePath: string,
    slug: string,
  ): Promise<AgentProfile | null> {
    try {
      const raw = await fs.readFile(filePath, "utf-8");
      const { data, content } = matter(raw);

      if (!data.name) return null;

      if (!data.id) {
        data.id = crypto.randomUUID();
        await fs.writeFile(filePath, matter.stringify(content, data), "utf-8");
      }

      return {
        id: data.id,
        name: data.name,
        slug,
        createdAt: data.createdAt,
        model: data.model,
        schedule: data.schedule,
        tools: data.tools,
        context: data.context,
        output: data.output,
        systemPrompt: content.trim(),
        filePath,
      };
    } catch {
      return null;
    }
  }
}
