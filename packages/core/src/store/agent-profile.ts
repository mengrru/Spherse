import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import matter from "gray-matter";
import type { AgentProfile } from "../types.js";

export class AgentProfileStore {
  private agentDir: string;

  constructor(agentDir: string) {
    this.agentDir = agentDir;
  }

  async list(): Promise<AgentProfile[]> {
    try {
      const entries = await fs.readdir(this.agentDir, { withFileTypes: true });
      const mdFiles = entries
        .filter((e) => e.isFile() && e.name.endsWith(".md"))
        .map((e) => path.join(this.agentDir, e.name));

      const profiles = await Promise.all(mdFiles.map((f) => this.parseFile(f)));
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

  async save(filename: string, content: string): Promise<AgentProfile> {
    const { data, content: body } = matter(content);

    if (!data.id) {
      data.id = crypto.randomUUID();
    }

    const serialized = matter.stringify(body, data);
    const filePath = path.join(this.agentDir, filename);
    await fs.mkdir(this.agentDir, { recursive: true });
    await fs.writeFile(filePath, serialized, "utf-8");

    return this.parseFile(filePath).then((p) => p!);
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
      await fs.unlink(profile.filePath);
    }
  }

  private async parseFile(filePath: string): Promise<AgentProfile | null> {
    try {
      const raw = await fs.readFile(filePath, "utf-8");
      const { data, content } = matter(raw);

      if (!data.name || !data.type) return null;

      if (!data.id) {
        data.id = crypto.randomUUID();
        await fs.writeFile(filePath, matter.stringify(content, data), "utf-8");
      }

      return {
        id: data.id,
        name: data.name,
        model: data.model,
        type: data.type,
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
