import fs from "node:fs/promises";
import path from "node:path";
import matter from "gray-matter";
import type { AgentDefinition } from "./types.js";

export async function parseAgentFile(
  filePath: string,
): Promise<AgentDefinition> {
  const raw = await fs.readFile(filePath, "utf-8");
  const { data, content } = matter(raw);

  if (!data.name) {
    throw new Error(
      `Agent file ${filePath}: missing required field "name" in frontmatter`,
    );
  }
  if (!data.type) {
    throw new Error(
      `Agent file ${filePath}: missing required field "type" in frontmatter`,
    );
  }

  return {
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
}

export async function listAgents(
  agentDir: string,
): Promise<AgentDefinition[]> {
  try {
    const entries = await fs.readdir(agentDir, { withFileTypes: true });
    const mdFiles = entries
      .filter((e) => e.isFile() && e.name.endsWith(".md"))
      .map((e) => path.join(agentDir, e.name));

    return Promise.all(mdFiles.map(parseAgentFile));
  } catch {
    return [];
  }
}
