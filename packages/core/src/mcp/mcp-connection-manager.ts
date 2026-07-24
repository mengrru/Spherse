import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { Logger } from "../logger.js";
import { createSilentLogger } from "../logger.js";
import { connectMcpServer, type McpConnection } from "./mcp-client.js";
import type { McpServerConfig } from "./types.js";

interface AgentEntry {
  tools: AgentTool[];
  connections: McpConnection[];
}

export type McpConnectFn = (
  servers: McpServerConfig[],
  logger: Logger,
) => Promise<{ tools: AgentTool[]; connections: McpConnection[] }>;

export type McpLoadServersFn = (agentId: string) => Promise<McpServerConfig[]>;

async function defaultConnect(
  servers: McpServerConfig[],
  logger: Logger,
): Promise<{ tools: AgentTool[]; connections: McpConnection[] }> {
  const results = await Promise.allSettled(
    servers.map((server) => connectMcpServer(server, logger)),
  );
  const tools: AgentTool[] = [];
  const connections: McpConnection[] = [];
  results.forEach((result, index) => {
    const server = servers[index];
    if (result.status === "fulfilled") {
      connections.push(result.value.connection);
      tools.push(...result.value.tools);
      logger.info(
        { server: server.name, tools: result.value.tools.length },
        "mcp server tools loaded",
      );
    } else {
      logger.warn(
        { err: result.reason, server: server.name },
        "mcp server connection failed",
      );
    }
  });
  return { tools, connections };
}

export class McpConnectionManager {
  private readonly entries = new Map<string, AgentEntry>();
  private readonly inflight = new Map<string, Promise<AgentEntry>>();
  private readonly logger: Logger;
  private readonly connect: McpConnectFn;
  private readonly loadServers: McpLoadServersFn;

  constructor(
    logger?: Logger,
    connect?: McpConnectFn,
    loadServers?: McpLoadServersFn,
  ) {
    this.logger = logger ?? createSilentLogger();
    this.connect = connect ?? defaultConnect;
    this.loadServers = loadServers ?? (() => Promise.resolve([]));
  }

  async getTools(agentId: string): Promise<AgentTool[]> {
    const cached = this.entries.get(agentId);
    if (cached) return cached.tools;

    let promise = this.inflight.get(agentId);
    if (!promise) {
      promise = this.doConnect(agentId);
      this.inflight.set(agentId, promise);
    }
    try {
      const entry = await promise;
      return entry.tools;
    } catch (err) {
      this.logger.warn({ err, agentId }, "mcp tool cache connect failed");
      return [];
    }
  }

  private async doConnect(agentId: string): Promise<AgentEntry> {
    try {
      const servers = (await this.loadServers(agentId)).filter((s) => s.enabled);
      const { tools, connections } = await this.connect(servers, this.logger);
      const entry: AgentEntry = { tools, connections };
      this.entries.set(agentId, entry);
      return entry;
    } finally {
      this.inflight.delete(agentId);
    }
  }

  async invalidate(agentId: string): Promise<void> {
    const entry = this.entries.get(agentId);
    this.entries.delete(agentId);
    if (entry) {
      await Promise.allSettled(entry.connections.map((c) => c.close()));
    }
  }

  async closeAll(): Promise<void> {
    const entries = [...this.entries.values()];
    this.entries.clear();
    await Promise.allSettled(
      entries.flatMap((e) => e.connections.map((c) => c.close())),
    );
  }
}

