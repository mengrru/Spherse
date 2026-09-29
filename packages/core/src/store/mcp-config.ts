import fs from "node:fs/promises";
import path from "node:path";
import { normalizeMcpConfig } from "../mcp/index.js";
import type { AgentMcpConfig } from "../mcp/index.js";
import type { Logger } from "../logger.js";
import { createSilentLogger } from "../logger.js";

export class McpConfigStore {
  private mcpPath: string;
  private readonly logger: Logger;

  constructor(agentDir: string, logger?: Logger) {
    this.mcpPath = path.join(agentDir, "mcp.json");
    this.logger = logger ?? createSilentLogger();
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
    return normalizeMcpConfig(JSON.parse(raw), (entry, reason) => {
      this.logger.warn({ entry, reason }, "mcp config entry dropped");
    });
  }

  async saveConfig(config: {
    servers: ReadonlyArray<Record<string, unknown>>;
  }): Promise<AgentMcpConfig> {
    const normalized = normalizeMcpConfig(config, (entry, reason) => {
      this.logger.warn({ entry, reason }, "mcp config entry dropped");
    });
    await fs.writeFile(this.mcpPath, JSON.stringify(normalized, null, 2), "utf-8");
    return normalized;
  }
}
