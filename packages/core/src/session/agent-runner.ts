import type { Agent, AgentEvent, AgentMessage, AgentTool } from "@earendil-works/pi-agent-core";
import { prepareAttachmentUserMessage, stripUserAttachments, type Attachment } from "../attachments/index.js";
import type { SamplingParams, ThinkingLevel } from "../types.js";
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
import { collectAbandonedSeqs, deriveMessages, repairLog } from "./fold.js";
import { SessionEventLog } from "./event-log.js";
import type { SessionEvent, SendMessageMeta } from "./events.js";
import { readCurrentTokens } from "../context/token-estimate.js";
import {
  buildAgent,
  buildPromptAndTools,
  composeStreamFn,
  previewTransformsFor,
  streamDecoratorsFor,
} from "./agent-assembly.js";

export type RunnerEventHandler = (event: AgentEvent | SessionControlEvent) => void;

export class AgentRunner {
  private eventLog: SessionEventLog | null = null;
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
    meta?: SendMessageMeta,
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

    this.eventLog!.appendBatch([
      {
        type: "user/message",
        data: {
          message: sanitizedUserMessage as never,
          ...(meta?.source !== undefined ? { source: meta.source } : {}),
          ...(meta?.triggerName !== undefined ? { triggerName: meta.triggerName } : {}),
        },
      },
      { type: "turn/start", data: {} },
    ]);

    const dispatch = createEventPipeline(
      [
        logEventMiddleware(sessionLogger),
        ...this.capabilityMiddlewares,
        ...(sanitizer ? [sanitizer.middleware] : []),
        this.persistMiddleware(),
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
    this.eventLog!.appendBatch([
      { type: "turn/retried", data: { abandonedSeqs: [lastEvent.seq] } },
      { type: "turn/start", data: {} },
    ]);
    this.syncBufferFromLog();

    const sessionLogger = this.deps.logger.child({ sessionId: this.sessionId });
    const dispatch = createEventPipeline(
      [
        logEventMiddleware(sessionLogger),
        ...this.capabilityMiddlewares,
        this.persistMiddleware(),
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

  async withdrawLastTurn(): Promise<number> {
    this.ensureNotBusy();
    const events = this.eventLog!.events;
    const lastUserEvent = [...events]
      .reverse()
      .find((event) => event.type === "user/message");
    if (!lastUserEvent || collectAbandonedSeqs(events).has(lastUserEvent.seq)) {
      throw new ValidationError(
        `Session "${this.sessionId}" has no user message to withdraw`,
      );
    }
    const lastCompaction = [...events]
      .reverse()
      .find((event) => event.type === "compaction/applied");
    if (lastCompaction && lastUserEvent.seq <= lastCompaction.data.anchorSeq) {
      throw new ValidationError(
        `Session "${this.sessionId}" last turn is already compacted into a digest and cannot be withdrawn`,
      );
    }
    this.eventLog!.append("turn/withdrawn", { seq: lastUserEvent.seq });
    this.syncBufferFromLog();
    return lastUserEvent.seq;
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
    // Same projection closure the agent loop consumes on the wire path
    // (contextProjectors + role filter), so the snapshot cannot drift from it.
    const raw = structuredClone(this.agent.state.messages);
    const converted = this.agent.convertToLlm(raw);
    let llmMessages: AgentMessage[];
    if (Array.isArray(converted)) {
      llmMessages = converted as AgentMessage[];
    } else {
      // buildAgent always wires a sync convertToLlm; if that ever changes,
      // degrade loudly instead of silently exporting the unprojected buffer.
      this.deps.logger.warn(
        { sessionId: this.sessionId },
        "convertToLlm returned a promise; turn context falls back to raw buffer",
      );
      llmMessages = raw;
    }
    // Replay stream-level message rewrites (e.g. time-perception prefixes)
    // in wire order — previewTransformsFor already reverses registration
    // order to match decorator onion composition.
    const profile = this.deps.projectStore.getAgent(this.agentId)?.getProfile();
    if (!profile) {
      this.deps.logger.warn(
        { sessionId: this.sessionId, agentId: this.agentId },
        "agent profile missing; turn context skips preview transforms",
      );
    } else {
      for (const transform of previewTransformsFor(this.deps.capabilities, this.viewOf(profile))) {
        llmMessages = transform(llmMessages);
      }
    }
    return {
      sessionId: this.sessionId,
      capturedAt: new Date().toISOString(),
      systemPrompt: this.agent.state.systemPrompt,
      messages: llmMessages,
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

  applyThinkingLevel(thinkingLevel: ThinkingLevel | undefined): void {
    const next = thinkingLevel ?? "medium";
    if (this.agent.state.thinkingLevel !== next) {
      this.agent.state.thinkingLevel = next;
    }
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

  private persistMiddleware(): EventMiddleware<AgentEvent> {
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
