import type { AgentEvent } from "@earendil-works/pi-agent-core";
import { AgentRunner } from "./agent-runner.js";
import type { RuntimeDeps } from "./runtime.js";
import type { TurnContextSnapshot, SessionControlEvent } from "./types.js";
import type { SessionStatus } from "./status.js";
import type { Attachment } from "../attachments/index.js";
import type { SamplingParams } from "../types.js";

export type AgentEventHandler = (event: AgentEvent | SessionControlEvent) => void;

export class LiveSession {
  private constructor(private readonly runner: AgentRunner) {}

  static async create(
    deps: RuntimeDeps,
    agentId: string,
    sessionId: string,
  ): Promise<LiveSession> {
    const runner = await AgentRunner.init(deps, agentId, sessionId);
    return new LiveSession(runner);
  }

  static async restore(
    deps: RuntimeDeps,
    agentId: string,
    sessionId: string,
  ): Promise<LiveSession> {
    const runner = await AgentRunner.initForRestore(deps, agentId, sessionId);
    return new LiveSession(runner);
  }

  getAgentId(): string {
    return this.runner.getAgentId();
  }

  markReloadPending(): void {
    this.runner.markReloadPending();
  }

  async sendMessage(
    message: string,
    attachments: Attachment[] = [],
    onEvent: AgentEventHandler,
  ): Promise<void> {
    return this.runner.sendMessage(message, attachments, onEvent);
  }

  async retryLastTurn(onEvent: AgentEventHandler): Promise<void> {
    return this.runner.retryLastTurn(onEvent);
  }

  abort(): void {
    this.runner.abort();
  }

  resolveControlRequest(requestId: string, decision: unknown): void {
    this.runner.resolveControlRequest(requestId, decision);
  }

  getTurnContext(): TurnContextSnapshot {
    return this.runner.getTurnContext();
  }

  getStatus(): SessionStatus {
    return this.runner.getStatus();
  }

  applyDefaultModel(globalDefaultModel: string | undefined): void {
    this.runner.applyDefaultModel(globalDefaultModel);
  }

  applySampling(sampling: SamplingParams | undefined): void {
    this.runner.applySampling(sampling);
  }
}
