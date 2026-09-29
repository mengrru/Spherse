import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { Logger } from "../logger.js";
import { createSilentLogger } from "../logger.js";
import { connectMcpServer, type ConnectServerOptions, type McpConnection } from "./mcp-client.js";
import type { McpServerConfig, McpServerInfo } from "./types.js";

const CONNECT_BUDGET_MS = 20_000;
const RETRY_BASE_MS = 30_000;
const RETRY_MAX_MS = 10 * 60_000;

interface ServerEntry {
  config: McpServerConfig;
  connection?: McpConnection;
  tools: AgentTool[];
  info?: McpServerInfo;
  lastError?: string;
  attempts: number;
  nextRetryAt?: number;
}

export type McpConnectFn = (
  server: McpServerConfig,
  logger: Logger,
  opts: ConnectServerOptions,
) => Promise<{ tools: AgentTool[]; connection: McpConnection; info: McpServerInfo }>;

export type McpLoadServersFn = (agentId: string) => Promise<McpServerConfig[]>;

export interface McpLoadResult {
  tools: AgentTool[];
  info: McpServerInfo[];
  revision: number;
}

export class McpConnectionManager {
  private readonly entries = new Map<string, Map<string, ServerEntry>>();
  private readonly inflight = new Map<string, Promise<void>>();
  private readonly epochs = new Map<string, number>();
  private readonly revisions = new Map<string, number>();
  private closed = false;
  private readonly logger: Logger;
  private readonly connect: McpConnectFn;
  private readonly loadServers: McpLoadServersFn;

  constructor(
    logger?: Logger,
    connect?: McpConnectFn,
    loadServers?: McpLoadServersFn,
  ) {
    this.logger = logger ?? createSilentLogger();
    this.connect = connect ?? connectMcpServer;
    this.loadServers = loadServers ?? (() => Promise.resolve([]));
  }

  async load(agentId: string): Promise<McpLoadResult> {
    if (this.closed) return { tools: [], info: [], revision: this.revision(agentId) };

    let pass = this.inflight.get(agentId);
    if (!pass) {
      pass = this.runPass(agentId).finally(() => this.inflight.delete(agentId));
      this.inflight.set(agentId, pass);
    }
    try {
      await pass;
    } catch (err) {
      this.logger.warn({ err, agentId }, "mcp load pass failed");
    }

    const servers = this.entries.get(agentId);
    if (!servers) return { tools: [], info: [], revision: this.revision(agentId) };
    const tools: AgentTool[] = [];
    const info: McpServerInfo[] = [];
    for (const [id, entry] of servers) {
      if (!entry.connection || !entry.info) continue;
      if (entry.connection.closed) {
        servers.delete(id);
        this.bumpRevision(agentId);
        continue;
      }
      tools.push(...entry.tools);
      info.push(entry.info);
    }
    return { tools, info, revision: this.revision(agentId) };
  }

  private async runPass(agentId: string): Promise<void> {
    const epoch = this.epochOf(agentId);
    let configs: McpServerConfig[] = [];
    try {
      configs = (await this.loadServers(agentId)).filter((s) => s.enabled);
    } catch (err) {
      this.logger.warn({ err, agentId }, "mcp config load failed");
      return;
    }

    const servers = this.entries.get(agentId) ?? new Map<string, ServerEntry>();
    this.entries.set(agentId, servers);

    const configIds = new Set(configs.map((c) => c.id));
    for (const [id, entry] of servers) {
      if (!configIds.has(id)) {
        servers.delete(id);
        if (entry.connection) void entry.connection.close();
      }
    }

    const now = Date.now();
    const due = configs.filter((config) => {
      const entry = servers.get(config.id);
      if (!entry) return true;
      if (entry.connection) return false;
      return entry.nextRetryAt === undefined || now >= entry.nextRetryAt;
    });
    if (due.length === 0) return;

    const results = await Promise.allSettled(
      due.map(async (config) => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), CONNECT_BUDGET_MS);
        try {
          const result = await this.connect(config, this.logger, {
            signal: controller.signal,
            onDisconnect: () => this.handleDisconnect(agentId, config.id),
          });
          return result;
        } finally {
          clearTimeout(timer);
        }
      }),
    );

    if (epoch !== this.epochOf(agentId)) {
      for (const result of results) {
        if (result.status === "fulfilled") void result.value.connection.close();
      }
      return;
    }

    let toolsetChanged = false;
    results.forEach((result, index) => {
      const config = due[index];
      if (result.status === "fulfilled") {
        if (result.value.connection.closed) {
          void result.value.connection.close();
          servers.set(config.id, {
            config,
            tools: [],
            attempts: 1,
            nextRetryAt: Date.now() + RETRY_BASE_MS,
            lastError: "connection closed immediately after connect",
          });
          return;
        }
        servers.set(config.id, {
          config,
          connection: result.value.connection,
          tools: result.value.tools,
          info: result.value.info,
          attempts: 0,
          nextRetryAt: undefined,
        });
        toolsetChanged = true;
        this.logger.info(
          { agentId, server: config.name, tools: result.value.tools.length },
          "mcp server tools loaded",
        );
      } else {
        const previous = servers.get(config.id);
        const attempts = (previous?.attempts ?? 0) + 1;
        const delay = Math.min(RETRY_BASE_MS * 2 ** (attempts - 1), RETRY_MAX_MS);
        const reason = result.reason instanceof Error ? result.reason.message : String(result.reason);
        servers.set(config.id, {
          config,
          tools: [],
          attempts,
          nextRetryAt: Date.now() + delay,
          lastError: reason,
        });
        this.logger.warn(
          { agentId, server: config.name, err: result.reason, retryInMs: delay },
          "mcp server connection failed",
        );
      }
    });

    if (toolsetChanged) this.bumpRevision(agentId);
  }

  revision(agentId: string): number {
    return this.revisions.get(agentId) ?? 0;
  }

  private bumpRevision(agentId: string): void {
    this.revisions.set(agentId, (this.revisions.get(agentId) ?? 0) + 1);
  }

  private epochOf(agentId: string): number {
    const current = this.epochs.get(agentId);
    if (current !== undefined) return current;
    this.epochs.set(agentId, 0);
    return 0;
  }

  private bumpEpoch(agentId: string): void {
    this.epochs.set(agentId, this.epochOf(agentId) + 1);
  }

  private handleDisconnect(agentId: string, serverId: string): void {
    if (this.closed) return;
    const servers = this.entries.get(agentId);
    const entry = servers?.get(serverId);
    if (!servers || !entry) return;
    servers.delete(serverId);
    this.bumpRevision(agentId);
    this.logger.warn(
      { agentId, serverId, server: entry.config.name },
      "mcp server disconnected unexpectedly",
    );
  }

  async invalidate(agentId: string): Promise<void> {
    this.bumpEpoch(agentId);
    const servers = this.entries.get(agentId);
    this.entries.delete(agentId);
    if (servers && servers.size > 0) {
      await Promise.allSettled(
        [...servers.values()].map((entry) => entry.connection?.close()),
      );
    }
    this.bumpRevision(agentId);
  }

  async closeAll(): Promise<void> {
    this.closed = true;
    for (const agentId of this.epochs.keys()) {
      this.bumpEpoch(agentId);
    }
    const all = [...this.entries.values()];
    this.entries.clear();
    await Promise.allSettled(
      all.flatMap((servers) =>
        [...servers.values()].map((entry) => entry.connection?.close()),
      ),
    );
  }
}
