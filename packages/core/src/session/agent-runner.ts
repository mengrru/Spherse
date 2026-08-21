import type { Agent, AgentEvent, AgentTool } from "@earendil-works/pi-agent-core";
import { prepareAttachmentUserMessage, type Attachment } from "../attachments/index.js";
import type { SamplingParams } from "../types.js";
import { NotFoundError, ValidationError } from "../errors.js";
import { createEventPipeline, type EventMiddleware } from "../kernel/event-pipeline.js";
import {
  appendEntry,
  dropLast,
  emptyLog,
  messagesOf,
  replaceMessage,
  type MessageLog,
} from "../kernel/message-log.js";
import type { SessionControlEvent } from "./types.js";
import { SessionControlBus } from "./control-bus.js";
import { createApprovalGate } from "./approval-gate.js";
import { createAskGate } from "./ask-gate.js";
import type { SessionStatus } from "./status.js";
import type { RuntimeDeps } from "./runtime.js";
import { logEventMiddleware, persistEventMiddleware } from "./event-middlewares.js";
import { createAttachmentSanitizer } from "../attachments/sanitizer.js";
import { composeTurnHooks, type TurnHooks } from "../kernel/turn-hooks.js";
import { logFromCompaction, logFromRows, synthesizeInterruptedToolResults } from "./compactor.js";
import { readCurrentTokens } from "../context/token-estimate.js";
import {
  buildAgent,
  buildPromptAndTools,
  composeStreamFn,
  streamDecoratorsFor,
} from "./agent-assembly.js";
import type { SessionStore } from "../store/session.js";

export type RunnerEventHandler = (event: AgentEvent | SessionControlEvent) => void;

export class AgentRunner {
  private log: MessageLog;
  private inFlight = false;
  private turnHooks: TurnHooks;
  private capabilityMiddlewares: ReadonlyArray<EventMiddleware<AgentEvent>> = [];
  private pendingReload = false;

  private constructor(
    private readonly agent: Agent,
    private readonly agentId: string,
    private readonly sessionId: string,
    private readonly deps: RuntimeDeps,
    private readonly controlBus: SessionControlBus,
  ) {
    this.log = emptyLog();
    this.turnHooks = composeTurnHooks([]);
  }

  static async init(
    deps: RuntimeDeps,
    agentId: string,
    sessionId: string,
    options?: { initialLog?: MessageLog },
  ): Promise<AgentRunner> {
    const agentStore = deps.projectStore.getAgent(agentId);
    if (!agentStore) throw new NotFoundError(`Agent profile "${agentId}" not found`);
    const controlBus = new SessionControlBus();
    const agent = await buildAgent(
      deps,
      agentStore.getProfile(),
      sessionId,
      createApprovalGate(controlBus),
      createAskGate(controlBus),
    );
    const runner = new AgentRunner(agent, agentId, sessionId, deps, controlBus);
    runner.turnHooks = composeTurnHooks(
      deps.createTurnHooks ? [deps.createTurnHooks(agentId, sessionId)] : [],
    );
    runner.capabilityMiddlewares = deps.capabilities.flatMap((c) => c.eventMiddlewares ?? []);
    if (options?.initialLog) {
      runner.log = options.initialLog;
      runner.syncBufferFromLog();
    }
    return runner;
  }

  static async initForRestore(
    deps: RuntimeDeps,
    agentId: string,
    sessionId: string,
  ): Promise<AgentRunner> {
    const agentStore = deps.projectStore.getAgent(agentId);
    if (!agentStore) throw new NotFoundError(`Agent "${agentId}" not found`);
    const session = agentStore.sessions.getSession(sessionId);
    if (!session) throw new NotFoundError(`Session "${sessionId}" not found`);

    const latest = agentStore.sessions.getLatestCompaction(sessionId);
    let initialLog = latest
      ? logFromCompaction(
          latest.anchorMessageId,
          latest.digestContent,
          latest.createdAt,
          agentStore.sessions
            .getMessagesAfter(sessionId, latest.anchorMessageId)
            .map((r) => ({ id: r.id, message: r.message })),
        )
      : logFromRows(agentStore.sessions.getSessionMessagesWithIds(sessionId));

    for (const message of synthesizeInterruptedToolResults(initialLog)) {
      const dbId = agentStore.sessions.appendMessage(sessionId, message);
      initialLog = appendEntry(initialLog, message, dbId);
    }

    return AgentRunner.init(deps, agentId, sessionId, { initialLog });
  }

  getAgentId(): string {
    return this.agentId;
  }

  get agentRef(): Agent {
    return this.agent;
  }

  get currentLog(): MessageLog {
    return this.log;
  }

  markReloadPending(): void {
    this.pendingReload = true;
  }

  async sendMessage(
    message: string,
    attachments: ReadonlyArray<Attachment>,
    onEvent: RunnerEventHandler,
  ): Promise<void> {
    this.ensureNotBusy();
    if (this.pendingReload) {
      this.pendingReload = false;
      await this.applyReload();
    }
    this.ensureModel();
    await this.turnHooks.beforeTurn?.(this.agent);
    const sessionLogger = this.deps.logger.child({ sessionId: this.sessionId });
    const agentStore = this.deps.projectStore.getAgent(this.agentId);

    const userMessage = await prepareAttachmentUserMessage(
      message,
      attachments,
      this.deps.projectRoot,
      this.deps.attachmentProcessors,
    );

    this.syncBufferFromLog();
    const sanitizer = createAttachmentSanitizer(attachments);

    const dispatch = createEventPipeline(
      [
        logEventMiddleware(sessionLogger),
        ...this.capabilityMiddlewares,
        ...(sanitizer ? [sanitizer.middleware] : []),
        this.persistMiddleware(agentStore),
      ],
      onEvent,
    );

    const previousSink = this.controlBus.swapEventSink(onEvent);
    const unsubscribe = this.agent.subscribe(dispatch);
    this.inFlight = true;

    try {
      await this.agent.prompt(userMessage);
      await this.applyAfterTurnHooks();
    } finally {
      if (sanitizer) {
        const result = sanitizer.finalize(this.agent.state.messages);
        this.agent.state.messages = result.messages;
        if (result.pair) {
          this.log = replaceMessage(this.log, result.pair.full, result.pair.stripped);
        }
      }
      unsubscribe();
      this.controlBus.swapEventSink(previousSink);
      this.inFlight = false;
    }
  }

  async retryLastTurn(onEvent: RunnerEventHandler): Promise<void> {
    this.ensureNotBusy();
    if (this.pendingReload) {
      this.pendingReload = false;
      await this.applyReload();
    }
    const last = this.log.entries[this.log.entries.length - 1];
    const lastBuffered = this.agent.state.messages[this.agent.state.messages.length - 1];
    if (
      !last ||
      !lastBuffered ||
      lastBuffered.role !== "assistant" ||
      (lastBuffered as { stopReason?: string }).stopReason !== "error"
    ) {
      throw new ValidationError(
        `Session "${this.sessionId}" has no failed assistant turn to retry`,
      );
    }

    this.ensureModel();
    const agentStore = this.deps.projectStore.getAgent(this.agentId);
    if (agentStore && last.dbId !== null) {
      agentStore.sessions.deleteMessage(this.sessionId, last.dbId);
    }
    this.log = dropLast(this.log);
    this.syncBufferFromLog();

    const sessionLogger = this.deps.logger.child({ sessionId: this.sessionId });
    const dispatch = createEventPipeline(
      [
        logEventMiddleware(sessionLogger),
        ...this.capabilityMiddlewares,
        this.persistMiddleware(agentStore),
      ],
      onEvent,
    );

    const previousSink = this.controlBus.swapEventSink(onEvent);
    const unsubscribe = this.agent.subscribe(dispatch);
    this.inFlight = true;

    try {
      await this.agent.continue();
      await this.applyAfterTurnHooks();
    } finally {
      unsubscribe();
      this.controlBus.swapEventSink(previousSink);
      this.inFlight = false;
    }
  }

  private ensureNotBusy(): void {
    if (this.inFlight) {
      throw new ValidationError(
        `Session "${this.sessionId}" already has a turn in progress`,
      );
    }
  }

  abort(): void {
    this.controlBus.rejectAll("session aborted");
    this.agent.abort();
  }

  resolveControlRequest(requestId: string, decision: unknown): void {
    this.controlBus.resolve(requestId, decision);
  }

  getTurnContext() {
    return {
      sessionId: this.sessionId,
      capturedAt: new Date().toISOString(),
      systemPrompt: this.agent.state.systemPrompt,
      messages: structuredClone(this.agent.state.messages),
      tools: this.agent.state.tools.map((tool: AgentTool) => ({
        name: tool.name,
        description: tool.description ?? "",
        parameters: structuredClone(tool.parameters),
      })),
    };
  }

  getStatus(): SessionStatus {
    return {
      currentTokens: readCurrentTokens(this.agent.state.messages, this.agent.state.systemPrompt),
      contextWindowLimit:
        (this.agent.state.model as { contextWindow?: number } | undefined)?.contextWindow ?? null,
    };
  }

  applyDefaultModel(globalDefaultModel: string | undefined): void {
    const profile = this.deps.projectStore.getAgent(this.agentId)?.getProfile();
    if (!profile) return;
    const resolved = this.deps.modelResolver.resolveFor(profile, globalDefaultModel);
    if (!resolved) return;
    const current = this.agent.state.model;
    if (current?.id !== resolved.id || current?.provider !== resolved.provider) {
      this.agent.state.model = resolved;
    }
  }

  applySampling(sampling: SamplingParams | undefined): void {
    const profile = this.deps.projectStore.getAgent(this.agentId)?.getProfile();
    if (!profile) return;
    this.agent.streamFunction = composeStreamFn(
      this.deps.modelCatalog,
      sampling,
      streamDecoratorsFor(this.deps.capabilities, this.viewOf(profile)),
    );
  }

  private viewOf(profile: import("../types.js").AgentProfile): import("../kernel/ports.js").SessionView {
    return {
      agentId: this.agentId,
      profile,
      projectStore: this.deps.projectStore,
      stores: this.deps.stores,
    };
  }

  async applyReload(): Promise<void> {
    const agentStore = this.deps.projectStore.getAgent(this.agentId);
    if (!agentStore) return;
    try {
      const profile = agentStore.getProfile();
      const { systemPrompt, tools } = await buildPromptAndTools(
        this.deps,
        profile,
        this.sessionId,
        createApprovalGate(this.controlBus),
        createAskGate(this.controlBus),
      );
      this.agent.state.systemPrompt = systemPrompt;
      this.agent.state.tools = tools;
      this.agent.streamFunction = composeStreamFn(
        this.deps.modelCatalog,
        this.deps.runConfig.current().sampling,
        streamDecoratorsFor(this.deps.capabilities, this.viewOf(profile)),
      );
      this.turnHooks.onReload?.();
      this.deps.logger.info(
        { sessionId: this.sessionId, agentId: this.agentId },
        "agent config reloaded for live session",
      );
    } catch (err) {
      this.deps.logger.warn(
        { err, sessionId: this.sessionId, agentId: this.agentId },
        "agent config reload failed, keeping previous config",
      );
    }
  }

  private async applyAfterTurnHooks(): Promise<void> {
    if (!this.turnHooks.afterTurn) return;
    const before = this.log;
    const after = await this.turnHooks.afterTurn(this.agent, before);
    if (after !== before) {
      this.log = after;
      this.syncBufferFromLog();
    }
  }

  private persistMiddleware(agentStore: { sessions: SessionStore } | undefined) {
    return persistEventMiddleware((msg): number | undefined => {
      const msgId = agentStore?.sessions.appendMessage(this.sessionId, msg);
      if (msgId !== undefined) {
        this.log = appendEntry(this.log, msg, msgId);
      }
      return msgId;
    });
  }

  private syncBufferFromLog(): void {
    this.agent.state.messages = messagesOf(this.log);
  }

  private ensureModel(): void {
    const profile = this.deps.projectStore.getAgent(this.agentId)?.getProfile();
    if (!profile) throw new NotFoundError(`Agent "${this.agentId}" not found`);
    this.agent.state.model = this.deps.modelResolver.resolveOrThrow(
      profile,
      this.deps.runConfig.current().defaultModel,
    );
  }
}
