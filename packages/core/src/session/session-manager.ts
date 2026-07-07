import type { ProjectStore } from "../store/project.js";
import { FileWriteMutex } from "../utils/file-write-mutex.js";
import { type Logger, createSilentLogger } from "../logger.js";
import { NotFoundError } from "../errors.js";
import { LiveSession, type AgentEventHandler } from "./live-session.js";
import type { SessionContext, TurnContextSnapshot } from "./types.js";

export class SessionManager {
  private readonly sessions = new Map<string, LiveSession>();
  private readonly ctx: SessionContext;

  constructor(
    projectStore: ProjectStore,
    options?: { defaultModel?: string; temperature?: number; logger?: Logger },
  ) {
    this.ctx = {
      projectStore,
      projectRoot: projectStore.getRootPath(),
      fileWriteMutex: new FileWriteMutex(),
      logger: options?.logger ?? createSilentLogger(),
      defaultModel: options?.defaultModel,
      temperature: options?.temperature,
    };
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
    onEvent: AgentEventHandler,
  ): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) throw new NotFoundError(`No active session "${sessionId}"`);
    return session.sendMessage(message, onEvent);
  }

  abortSession(sessionId: string): void {
    this.sessions.get(sessionId)?.abort();
  }

  getTurnContext(sessionId: string): TurnContextSnapshot {
    const session = this.sessions.get(sessionId);
    if (!session) throw new NotFoundError(`No active session "${sessionId}"`);
    return session.getTurnContext();
  }

  destroySession(sessionId: string): void {
    this.sessions.delete(sessionId);
  }

  hasActiveSession(sessionId: string): boolean {
    return this.sessions.has(sessionId);
  }

  evictAgent(agentId: string): void {
    for (const [sessionId, session] of this.sessions) {
      if (session.getAgentId() === agentId) {
        this.sessions.delete(sessionId);
      }
    }
  }

  closeAll(): void {
    this.sessions.clear();
  }

  setDefaultModel(model: string | undefined): void {
    this.ctx.defaultModel = model;
    for (const session of this.sessions.values()) {
      session.applyDefaultModel(model);
    }
  }

  setTemperature(temperature: number | undefined): void {
    this.ctx.temperature = temperature;
    for (const session of this.sessions.values()) {
      session.applyTemperature(temperature);
    }
  }
}
