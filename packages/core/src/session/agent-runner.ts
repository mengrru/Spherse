import type { Agent, AgentEvent, AgentTool } from "@earendil-works/pi-agent-core";
import { prepareAttachmentUserMessage, stripUserAttachments, type Attachment } from "../attachments/index.js";
import type { SamplingParams } from "../types.js";
import { MigrationRequiredError, NotFoundError, ValidationError } from "../errors.js";
import { createEventPipeline, type EventMiddleware } from "../kernel/event-pipeline.js";
import type { SessionControlEvent } from "./types.js";
import { SessionControlBus } from "./control-bus.js";
import { createApprovalGate } from "./approval-gate.js";
import { createAskGate } from "./ask-gate.js";
import type { SessionStatus } from "./status.js";
import type { RuntimeDeps } from "./runtime.js";
import { logEventMiddleware } from "./event-middlewares.js";
import { createAttachmentSanitizer } from "../attachments/sanitizer.js";
import { composeTurnHooks, type TurnHooks } from "../kernel/turn-hooks.js";
import { deriveMessages, repairLog } from "./fold.js";
import { SessionEventLog } from "./event-log.js";
import type { SessionEvent } from "./events.js";
import { readCurrentTokens } from "../context/token-estimate.js";
import {
  buildAgent,
  buildPromptAndTools,
  composeStreamFn,
  streamDecoratorsFor,
} from "./agent-assembly.js";

export type RunnerEventHandler = (event: AgentEvent | SessionControlEvent) => void;

export class AgentRunner {
  private eventLog: SessionEventLog | null = null;
  private turnCounter = 0;
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
    this.turnHooks = composeTurnHooks([]);
  }

  static async init(
    deps: RuntimeDeps,
    agentId: string,
    sessionId: string,
    options?: { eventLog?: SessionEventLog },
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
    runner.eventLog =
      options?.eventLog ?? SessionEventLog.open(agentStore.sessions, sessionId);
    runner.turnCounter = countTurns(runner.eventLog.events);
    if (runner.eventLog.events.length > 0) {
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
    if (agentStore.sessions.sessionNeedsMigration(sessionId)) {
      throw new MigrationRequiredError(
        `Session "${sessionId}" uses the legacy message format and must be migrated first`,
      );
    }

    const eventLog = SessionEventLog.open(agentStore.sessions, sessionId);
    const repairs = repairLog(eventLog.events);
    eventLog.appendBatch(
      repairs.map((repair) => ({ type: repair.type, data: repair.data })),
    );
    return AgentRunner.init(deps, agentId, sessionId, { eventLog });
  }

  getAgentId(): string {
    return this.agentId;
  }

  get agentRef(): Agent {
    return this.agent;
  }

  get currentEvents(): readonly SessionEvent[] {
    return this.eventLog?.events ?? [];
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
    this.ensureWritable();
    await this.turnHooks.beforeTurn?.(this.agent);
    const sessionLogger = this.deps.logger.child({ sessionId: this.sessionId });

    const sanitizer = createAttachmentSanitizer(attachments);
    const userMessage = await prepareAttachmentUserMessage(
      message,
      attachments,
      this.deps.projectRoot,
      this.deps.attachmentProcessors,
    );
    const sanitizedUserMessage = sanitizer
      ? (stripUserAttachments(userMessage as never, attachments) as typeof userMessage)
      : userMessage;

    const turn = this.turnCounter;
    this.eventLog!.appendBatch([
      { type: "user/message", data: { message: sanitizedUserMessage as never } },
      { type: "turn/start", data: { turn } },
    ]);
    this.turnCounter++;

    const dispatch = createEventPipeline(
      [
        logEventMiddleware(sessionLogger),
        ...this.capabilityMiddlewares,
        ...(sanitizer ? [sanitizer.middleware] : []),
        this.persistMiddleware(turn),
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
    const lastEvent = [...this.eventLog!.events]
      .reverse()
      .find((event) => event.type === "assistant/message");
    const lastBuffered = this.agent.state.messages[this.agent.state.messages.length - 1];
    if (
      !lastEvent ||
      lastEvent.type !== "assistant/message" ||
      !lastBuffered ||
      lastBuffered.role !== "assistant" ||
      (lastBuffered as { stopReason?: string }).stopReason !== "error"
    ) {
      throw new ValidationError(
        `Session "${this.sessionId}" has no failed assistant turn to retry`,
      );
    }

    this.ensureModel();
    const retryTurn = this.turnCounter;
    this.eventLog!.appendBatch([
      { type: "turn/retried", data: { abandonedSeqs: [lastEvent.seq] } },
      { type: "turn/start", data: { turn: retryTurn } },
    ]);
    this.turnCounter++;
    this.syncBufferFromLog();

    const sessionLogger = this.deps.logger.child({ sessionId: this.sessionId });
    const dispatch = createEventPipeline(
      [
        logEventMiddleware(sessionLogger),
        ...this.capabilityMiddlewares,
        this.persistMiddleware(retryTurn),
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

  private ensureWritable(): void {
    if (!this.eventLog) {
      throw new MigrationRequiredError(
        `Session "${this.sessionId}" has no event log attached`,
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
    if (!this.turnHooks.afterTurn || !this.eventLog) return;
    const eventsBefore = this.eventLog.events.length;
    await this.turnHooks.afterTurn(this.agent, this.eventLog);
    if (this.eventLog.events.length !== eventsBefore) {
      this.syncBufferFromLog();
    }
  }

  private persistMiddleware(turn: number): EventMiddleware<AgentEvent> {
    return (event, next) => {
      if (this.eventLog) {
        if (event.type === "message_end") {
          this.appendMessageEvent(event.message);
        } else if (event.type === "agent_end") {
          const lastMessage = [...event.messages]
            .reverse()
            .find((message) => message.role === "assistant") as
            | { stopReason?: string }
            | undefined;
          this.eventLog.append("turn/end", {
            turn,
            reason:
              lastMessage?.stopReason === "error"
                ? "error"
                : lastMessage?.stopReason === "aborted"
                  ? "aborted"
                  : "completed",
          });
        }
      }
      next(event);
    };
  }

  private appendMessageEvent(message: unknown): void {
    const role = (message as { role?: string }).role;
    if (role === "assistant") {
      this.eventLog!.append("assistant/message", { message: message as never });
    } else if (role === "toolResult") {
      this.eventLog!.append("tool/result", { message: message as never });
    }
  }

  private syncBufferFromLog(): void {
    if (this.eventLog) {
      this.agent.state.messages = deriveMessages(this.eventLog.events);
    }
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

function countTurns(events: readonly SessionEvent[]): number {
  let count = 0;
  for (const event of events) {
    if (event.type === "turn/start") count++;
  }
  return count;
}
