import type { ProjectStore, AgentChangePayload } from "../store/project.js";
import { FileWriteMutex } from "../utils/file-write-mutex.js";
import { type Logger, createSilentLogger } from "../logger.js";
import { NotFoundError } from "../errors.js";
import { LiveSession, type AgentEventHandler } from "./live-session.js";
import { computeSessionStatus, type SessionStatus } from "./status.js";
import type { SamplingParams } from "../types.js";
import type { SessionContext, TurnContextSnapshot } from "./types.js";
import type { TriggerManager } from "../trigger/trigger-manager.js";
import { McpConnectionManager } from "../mcp/mcp-connection-manager.js";
import type { Attachment } from "../attachments/index.js";

export class SessionManager {
  private readonly sessions = new Map<string, LiveSession>();
  private readonly ctx: SessionContext;
  private readonly mcpConnectionManager: McpConnectionManager;

  constructor(
    projectStore: ProjectStore,
    options?: { defaultModel?: string; sampling?: SamplingParams; logger?: Logger },
  ) {
    const logger = options?.logger ?? createSilentLogger();
    const loadServers = async (agentId: string) => {
      const agentStore = projectStore.getAgent(agentId);
      if (!agentStore) return [];
      try {
        return (await agentStore.mcp.getConfig()).servers;
      } catch (err) {
        logger.warn({ err, agentId }, "failed to load agent mcp config");
        return [];
      }
    };
    this.mcpConnectionManager = new McpConnectionManager(logger, undefined, loadServers);
    this.ctx = {
      projectStore,
      projectRoot: projectStore.getRootPath(),
      fileWriteMutex: new FileWriteMutex(),
      logger,
      defaultModel: options?.defaultModel,
      sampling: options?.sampling,
      mcpConnectionManager: this.mcpConnectionManager,
    };
    projectStore.on("agent_updated", (payload: AgentChangePayload) => {
      if (payload.action !== "updated") return;
      for (const session of this.sessions.values()) {
        if (session.getAgentId() === payload.agentId) session.markReloadPending();
      }
    });
  }

  setTriggerManager(triggerManager: TriggerManager): void {
    this.ctx.triggerManager = triggerManager;
  }

  async createSession(agentId: string, source?: string): Promise<string> {
    const agentStore = this.ctx.projectStore.getAgent(agentId);
    if (!agentStore) throw new NotFoundError(`Agent profile "${agentId}" not found`);
    const sessionId = agentStore.sessions.createSession(undefined, source);
    const session = await LiveSession.create(this.ctx, agentId, sessionId);
    this.sessions.set(sessionId, session);
    this.ctx.logger.info({ sessionId, agentId }, "session created");
    return sessionId;
  }

  async restoreSession(agentId: string, sessionId: string): Promise<string> {
    if (this.sessions.has(sessionId)) return sessionId;
    const session = await LiveSession.restore(this.ctx, agentId, sessionId);
    this.sessions.set(sessionId, session);
    this.ctx.logger.info({ sessionId }, "session restored");
    return sessionId;
  }

  async sendMessage(
    sessionId: string,
    message: string,
    attachments: Attachment[],
    onEvent: AgentEventHandler,
  ): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) throw new NotFoundError(`No active session "${sessionId}"`);
    return session.sendMessage(message, attachments, onEvent);
  }

  abortSession(sessionId: string): void {
    this.sessions.get(sessionId)?.abort();
  }

  resolveControlRequest(sessionId: string, requestId: string, decision: unknown): void {
    this.sessions.get(sessionId)?.resolveControlRequest(requestId, decision);
  }

  getTurnContext(sessionId: string): TurnContextSnapshot {
    const session = this.sessions.get(sessionId);
    if (!session) throw new NotFoundError(`No active session "${sessionId}"`);
    return session.getTurnContext();
  }

  getSessionStatus(agentId: string, sessionId: string): SessionStatus {
    const live = this.sessions.get(sessionId);
    if (live) return live.getStatus();
    const agentStore = this.ctx.projectStore.getAgent(agentId);
    if (!agentStore) throw new NotFoundError(`Agent "${agentId}" not found`);
    if (!agentStore.sessions.getSession(sessionId)) {
      throw new NotFoundError(`Session "${sessionId}" not found`);
    }
    const messages = agentStore.sessions.getSessionMessages(sessionId);
    return computeSessionStatus(messages, agentStore.getProfile(), this.ctx.defaultModel);
  }

  destroySession(sessionId: string): void {
    this.sessions.delete(sessionId);
  }

  hasActiveSession(sessionId: string): boolean {
    return this.sessions.has(sessionId);
  }

  sessionExists(agentId: string, sessionId: string): boolean {
    if (this.sessions.has(sessionId)) return true;
    const agentStore = this.ctx.projectStore.getAgent(agentId);
    return !!agentStore?.sessions.getSession(sessionId);
  }

  evictAgent(agentId: string): void {
    for (const [sessionId, session] of this.sessions) {
      if (session.getAgentId() === agentId) {
        this.sessions.delete(sessionId);
      }
    }
  }

  async invalidateMcpCache(agentId: string): Promise<void> {
    await this.mcpConnectionManager.invalidate(agentId);
  }

  async closeAll(): Promise<void> {
    this.sessions.clear();
    await this.mcpConnectionManager.closeAll();
  }

  setDefaultModel(model: string | undefined): void {
    this.ctx.defaultModel = model;
    for (const session of this.sessions.values()) {
      session.applyDefaultModel(model);
    }
  }

  setSampling(sampling: SamplingParams | undefined): void {
    this.ctx.sampling = sampling;
    for (const session of this.sessions.values()) {
      session.applySampling(sampling);
    }
  }
}
