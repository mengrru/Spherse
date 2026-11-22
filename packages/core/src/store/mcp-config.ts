import { normalizeMcpConfig } from "../mcp/index.js";
import type { AgentMcpConfig } from "../mcp/index.js";
import type { Logger } from "../logger.js";
import { createSilentLogger } from "../logger.js";
import type { FsPort } from "./fs-port.js";

export class McpConfigStore {
  private fsPort: FsPort;
  private relMcpPath: string;
  private readonly logger: Logger;

  constructor(fsPort: FsPort, relMcpPath: string, logger?: Logger) {
    this.fsPort = fsPort;
    this.relMcpPath = relMcpPath;
    this.logger = logger ?? createSilentLogger();
  }

  async getConfig(): Promise<AgentMcpConfig> {
    let raw: string;
    try {
      raw = await this.fsPort.readFile(this.relMcpPath);
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
    await this.fsPort.writeFile(this.relMcpPath, JSON.stringify(normalized, null, 2));
    return normalized;
  }
}
