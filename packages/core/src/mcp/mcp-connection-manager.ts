import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { Logger } from "../logger.js";
import { createSilentLogger } from "../logger.js";
import { connectMcpServer, type McpConnection } from "./mcp-client.js";
import type { McpServerConfig, McpServerInfo } from "./types.js";

interface AgentEntry {
  tools: AgentTool[];
  connections: McpConnection[];
  info: McpServerInfo[];
}

export type McpConnectFn = (
  servers: McpServerConfig[],
  logger: Logger,
) => Promise<{ tools: AgentTool[]; connections: McpConnection[]; info: McpServerInfo[] }>;

export type McpLoadServersFn = (agentId: string) => Promise<McpServerConfig[]>;

async function defaultConnect(
  servers: McpServerConfig[],
  logger: Logger,
): Promise<{ tools: AgentTool[]; connections: McpConnection[]; info: McpServerInfo[] }> {
  const results = await Promise.allSettled(
    servers.map((server) => connectMcpServer(server, logger)),
  );
  const tools: AgentTool[] = [];
  const connections: McpConnection[] = [];
  const info: McpServerInfo[] = [];
  results.forEach((result, index) => {
    const server = servers[index];
    if (result.status === "fulfilled") {
      connections.push(result.value.connection);
      tools.push(...result.value.tools);
      info.push(result.value.info);
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
  return { tools, connections, info };
}

export class McpConnectionManager {
  private readonly entries = new Map<string, AgentEntry>();
  private readonly inflight = new Map<string, Promise<AgentEntry>>();
  private readonly configVersions = new Map<string, number>();
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

  async load(agentId: string): Promise<{ tools: AgentTool[]; info: McpServerInfo[] }> {
    const cached = this.entries.get(agentId);
    if (cached) return { tools: cached.tools, info: cached.info };

    let promise = this.inflight.get(agentId);
    if (!promise) {
      promise = this.doConnect(agentId);
      this.inflight.set(agentId, promise);
    }
    try {
      const entry = await promise;
      return { tools: entry.tools, info: entry.info };
    } catch (err) {
      this.logger.warn({ err, agentId }, "mcp tool cache connect failed");
      return { tools: [], info: [] };
    }
  }

  private async doConnect(agentId: string): Promise<AgentEntry> {
    try {
      const servers = (await this.loadServers(agentId)).filter((s) => s.enabled);
      const { tools, connections, info } = await this.connect(servers, this.logger);
      const entry: AgentEntry = { tools, connections, info };
      this.entries.set(agentId, entry);
      return entry;
    } finally {
      this.inflight.delete(agentId);
    }
  }

  configVersion(agentId: string): number {
    return this.configVersions.get(agentId) ?? 0;
  }

  async invalidate(agentId: string): Promise<void> {
    this.configVersions.set(agentId, this.configVersion(agentId) + 1);
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

