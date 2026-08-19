import type { AgentChangePayload } from "../store/project.js";
import type { Logger } from "../logger.js";
import { NotFoundError } from "../errors.js";
import { AgentRunner, type RunnerEventHandler } from "./agent-runner.js";
import { computeSessionStatus, type SessionStatus } from "./status.js";
import type { TurnContextSnapshot } from "./types.js";
import type { Attachment } from "../attachments/index.js";
import { RunConfigHolder, type RuntimeDeps } from "./runtime.js";

export class SessionManager {
  private readonly sessions = new Map<string, AgentRunner>();
  private readonly deps: RuntimeDeps;
  private readonly runConfigHolder: RunConfigHolder;

  constructor(deps: RuntimeDeps, options?: { initialRunConfig?: RunConfigHolder }) {
    this.deps = deps;
    this.runConfigHolder = options?.initialRunConfig ?? new RunConfigHolder();
    deps.projectStore.on("agent_updated", (payload: AgentChangePayload) => {
      if (payload.action !== "updated") return;
      for (const session of this.sessions.values()) {
        if (session.getAgentId() === payload.agentId) session.markReloadPending();
      }
    });
  }

  get logger(): Logger {
    return this.deps.logger;
  }

  getRuntimeDeps(): RuntimeDeps {
    return this.deps;
  }

  getRunConfigHolder(): RunConfigHolder {
    return this.runConfigHolder;
  }

  async createSession(agentId: string, source?: string, title?: string): Promise<string> {
    const agentStore = this.deps.projectStore.getAgent(agentId);
    if (!agentStore) throw new NotFoundError(`Agent profile "${agentId}" not found`);
    const sessionId = agentStore.sessions.createSession(title, source);
    const session = await AgentRunner.init(this.deps, agentId, sessionId);
    this.sessions.set(sessionId, session);
    this.deps.logger.info({ sessionId, agentId }, "session created");
    return sessionId;
  }

  async restoreSession(agentId: string, sessionId: string): Promise<string> {
    if (this.sessions.has(sessionId)) return sessionId;
    const session = await AgentRunner.initForRestore(this.deps, agentId, sessionId);
    this.sessions.set(sessionId, session);
    this.deps.logger.info({ sessionId }, "session restored");
    return sessionId;
  }

  async sendMessage(
    sessionId: string,
    message: string,
    attachments: Attachment[],
    onEvent: RunnerEventHandler,
  ): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) throw new NotFoundError(`No active session "${sessionId}"`);
    return session.sendMessage(message, attachments, onEvent);
  }

  abortSession(sessionId: string): void {
    this.sessions.get(sessionId)?.abort();
  }

  async retryLastTurn(
    sessionId: string,
    onEvent: RunnerEventHandler,
  ): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) throw new NotFoundError(`No active session "${sessionId}"`);
    return session.retryLastTurn(onEvent);
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
    const runner = this.sessions.get(sessionId);
    if (runner) return runner.getStatus();
    const agentStore = this.deps.projectStore.getAgent(agentId);
    if (!agentStore) throw new NotFoundError(`Agent "${agentId}" not found`);
    if (!agentStore.sessions.getSession(sessionId)) {
      throw new NotFoundError(`Session "${sessionId}" not found`);
    }
    const messages = agentStore.sessions.getSessionMessages(sessionId);
    return computeSessionStatus(
      messages,
      agentStore.getProfile(),
      this.deps.modelCatalog.resolveModelById.bind(this.deps.modelCatalog),
      this.runConfigHolder.current().defaultModel,
    );
  }

  destroySession(sessionId: string): void {
    this.sessions.delete(sessionId);
  }

  hasActiveSession(sessionId: string): boolean {
    return this.sessions.has(sessionId);
  }

  sessionExists(agentId: string, sessionId: string): boolean {
    if (this.sessions.has(sessionId)) return true;
    const agentStore = this.deps.projectStore.getAgent(agentId);
    return !!agentStore?.sessions.getSession(sessionId);
  }

  evictAgent(agentId: string): void {
    for (const [sessionId, session] of this.sessions) {
      if (session.getAgentId() === agentId) {
        this.sessions.delete(sessionId);
      }
    }
  }

  async closeAll(): Promise<void> {
    this.sessions.clear();
  }

  setDefaultModel(model: string | undefined): void {
    this.runConfigHolder.update({ defaultModel: model });
    for (const session of this.sessions.values()) {
      session.applyDefaultModel(model);
    }
  }

  setSampling(sampling: Parameters<RunConfigHolder["update"]>[0]["sampling"]): void {
    this.runConfigHolder.update({ sampling });
    for (const session of this.sessions.values()) {
      session.applySampling(sampling);
    }
  }
}
