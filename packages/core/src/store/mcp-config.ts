import fs from "node:fs/promises";
import path from "node:path";
import { normalizeMcpConfig } from "../mcp/index.js";
import type { AgentMcpConfig } from "../mcp/index.js";

export class McpConfigStore {
  private mcpPath: string;

  constructor(agentDir: string) {
    this.mcpPath = path.join(agentDir, "mcp.json");
  }

  async getConfig(): Promise<AgentMcpConfig> {
    let raw: string;
    try {
      raw = await fs.readFile(this.mcpPath, "utf-8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        return { servers: [] };
      }
      throw err;
    }
    return normalizeMcpConfig(JSON.parse(raw));
  }

  async saveConfig(config: {
    servers: ReadonlyArray<Record<string, unknown>>;
  }): Promise<AgentMcpConfig> {
    const normalized = normalizeMcpConfig(config);
    await fs.writeFile(this.mcpPath, JSON.stringify(normalized, null, 2), "utf-8");
    return normalized;
  }
}
