import {
  ConflictError,
  type Attachment,
  type SessionManager,
} from "@spherse/core";
import type { FastifyBaseLogger } from "fastify";
import { ChannelClosedError } from "../errors.js";
import { classifyRunError } from "./classify-run-error.js";
import { ChatWireProjector } from "./chat-wire-projector.js";

type CoreEventHandler = Parameters<SessionManager["sendMessage"]>[3];
type CoreEvent = Parameters<CoreEventHandler>[0];
type Subscriber = (event: unknown) => void;

const REPLAY_BATCH_SIZE = 200;
const REPLAY_READ_LIMIT = Number.MAX_SAFE_INTEGER;

export type ChannelState = "opening" | "open" | "closed";
export type ChannelCloseReason = "idle" | "runtime-closed" | "server-closed" | "restore-failed";

export type ControlRequestDecision =
  | { approved: boolean; reason?: string }
  | { answer?: string; timedOut: boolean };

export interface ChatSessionAttachment {
  ready: Promise<void>;
  sendMessage(content: string, attachments?: Attachment[], clientId?: string): Promise<void>;
  retryLastTurn(): Promise<void>;
  withdrawLastTurn(): Promise<void>;
  abort(): void;
  resolveControlRequest(
    requestId: string,
    decision: ControlRequestDecision,
  ): void;
  close(): void;
}

export class ChatChannel {
  private state: ChannelState = "opening";
  private readyPromise?: Promise<void>;
  private leases = 0;
  private readonly subscribers = new Set<Subscriber>();
  private running = false;
  private runEvents: CoreEvent[] = [];
  private readonly projector = new ChatWireProjector();
  private logUnsubscribe?: () => void;

  private constructor(
    private readonly runtime: SessionManager,
    private readonly logger: FastifyBaseLogger,
    readonly agentId: string,
    readonly sessionId: string,
    private readonly dispose: () => void,
  ) {}

  static open(
    runtime: SessionManager,
    logger: FastifyBaseLogger,
    agentId: string,
    sessionId: string,
    dispose: () => void,
  ): ChatChannel {
    return new ChatChannel(runtime, logger, agentId, sessionId, dispose);
  }

  attach(subscriber: Subscriber, since?: number): ChatSessionAttachment {
    if (this.state === "closed") {
      throw new ChannelClosedError(`Chat channel for session "${this.sessionId}" is closed`);
    }
    this.leases += 1;
    let active = true;
    let subscribed = false;

    const ready = this.ensureReady().then(() => {
      if (!active) return;
      if (this.state !== "open") {
        throw new ChannelClosedError(`Chat channel for session "${this.sessionId}" is closed`);
      }
      this.handshake(subscriber, since);
      this.subscribers.add(subscriber);
      subscribed = true;
    });
    void ready.catch(() => {});

    const ensureUsable = async (): Promise<boolean> => {
      await ready;
      if (!active) return false;
      if (this.state !== "open") {
        throw new ChannelClosedError(`Chat channel for session "${this.sessionId}" is closed`);
      }
      return true;
    };

    return {
      ready,
      sendMessage: async (content, attachments, clientId) => {
        if (!(await ensureUsable())) return;
        try {
          await this.startRun((onEvent) => {
            if (clientId !== undefined) this.projector.markPendingEcho(clientId);
            return this.runtime.sendMessage(
              this.sessionId,
              content,
              attachments ?? [],
              onEvent,
            );
          });
        } catch (err) {
          if (clientId !== undefined) {
            this.projector.discardPendingEcho(clientId);
          }
          throw err;
        }
      },
      retryLastTurn: async () => {
        if (!(await ensureUsable())) return;
        await this.startRun((onEvent) =>
          this.runtime.retryLastTurn(this.sessionId, onEvent),
        );
      },
      withdrawLastTurn: async () => {
        if (!(await ensureUsable())) return;
        if (this.running) {
          throw new ConflictError(`Session "${this.sessionId}" is already running`);
        }
        await this.runtime.withdrawLastTurn(this.sessionId);
      },
      abort: () => {
        if (active && this.state !== "closed") this.runtime.abortSession(this.sessionId);
      },
      resolveControlRequest: (requestId, decision) => {
        if (active && this.state !== "closed") {
          this.runtime.resolveControlRequest(this.sessionId, requestId, decision);
        }
      },
      close: () => {
        if (!active) return;
        active = false;
        this.leases = Math.max(0, this.leases - 1);
        if (subscribed) this.subscribers.delete(subscriber);
        this.cleanupIfIdle();
      },
    };
  }

  async startDetachedRun(content: string): Promise<void> {
    if (this.state === "closed") {
      throw new ChannelClosedError(`Chat channel for session "${this.sessionId}" is closed`);
    }
    this.leases += 1;
    try {
      await this.ensureReady();
      if (this.state !== "open") {
        throw new ChannelClosedError(`Chat channel for session "${this.sessionId}" is closed`);
      }
      if (this.running) {
        throw new ConflictError(`Session "${this.sessionId}" is already running`);
      }
    } catch (err) {
      this.leases -= 1;
      this.cleanupIfIdle();
      throw err;
    }
    this.startRun((onEvent) =>
      this.runtime.sendMessage(this.sessionId, content, [], onEvent),
    )
      .catch((err) => {
        this.logger.error({ err, sessionId: this.sessionId }, "detached chat run failed");
        this.publish({
          type: "error",
          message: err instanceof Error ? err.message : "chat error",
          code: classifyRunError(err),
        });
      })
      .finally(() => {
        this.leases -= 1;
        this.cleanupIfIdle();
      });
  }

  close(reason: ChannelCloseReason): void {
    if (this.state === "closed") return;
    this.state = "closed";
    this.releaseSubscription();
    this.subscribers.clear();
    this.runEvents = [];
    this.dispose();
    this.logger.info({ sessionId: this.sessionId, reason }, "chat channel closed");
  }

  private cleanupIfIdle(): void {
    if (
      this.state !== "open" ||
      this.leases > 0 ||
      this.running ||
      this.projector.isRunActive()
    ) {
      return;
    }
    const released = this.runtime.releaseSession(this.sessionId);
    this.logger.debug({ sessionId: this.sessionId, released }, "chat channel released session");
    this.close("idle");
  }

  private ensureReady(): Promise<void> {
    if (this.state === "closed") {
      return Promise.reject(
        new ChannelClosedError(`Chat channel for session "${this.sessionId}" is closed`),
      );
    }
    this.readyPromise ??= this.start();
    return this.readyPromise;
  }

  private async start(): Promise<void> {
    try {
      await this.runtime.restoreSession(this.agentId, this.sessionId);
    } catch (err) {
      this.close("restore-failed");
      this.logger.warn({ err, sessionId: this.sessionId }, "chat channel restore failed");
      throw err;
    }
    if (this.state === "closed") return;
    this.state = "open";
    this.subscribeLog();
    this.logger.debug({ sessionId: this.sessionId }, "chat channel opened");
    this.cleanupIfIdle();
  }

  private releaseSubscription(): void {
    this.logUnsubscribe?.();
    this.logUnsubscribe = undefined;
  }

  private subscribeLog(): void {
    this.initRunStateFromLog();
    this.logUnsubscribe = this.runtime.subscribeSessionEvents(this.sessionId, (event) => {
      if (this.state !== "open") return;
      const wireEvent = this.projector.consumeLogEvent(event);
      if (wireEvent !== undefined) {
        this.publish(wireEvent);
      }
      if (wireEvent?.type === "run_status" && wireEvent.active === false) {
        this.cleanupIfIdle();
      }
    }) ?? undefined;
  }

  private initRunStateFromLog(): void {
    const lastSeq = this.runtime.getSessionLastSeq(this.agentId, this.sessionId);
    if (lastSeq < 0) return;
    const PAGE = 200;
    let since = lastSeq - PAGE;
    for (;;) {
      const events = this.runtime.readSessionEventsAfter(
        this.agentId,
        this.sessionId,
        since,
        PAGE,
      );
      if (events.length === 0) return;
      for (let i = events.length - 1; i >= 0; i--) {
        if (events[i].type === "turn/end") return;
        if (events[i].type === "turn/start") {
          this.projector.markRunActive();
          return;
        }
      }
      const oldest = events[0].seq;
      if (oldest <= 0) return;
      since = oldest - 1 - PAGE;
    }
  }

  private handshake(subscriber: Subscriber, since: number | undefined): void {
    if (this.state !== "open") return;
    const lastSeq = this.runtime.getSessionLastSeq(this.agentId, this.sessionId);
    this.notify(subscriber, {
      type: "session_ready",
      lastSeq,
      replay: true,
    });
    if (since !== undefined) {
      const events = this.runtime.readSessionEventsAfter(
        this.agentId,
        this.sessionId,
        since,
        REPLAY_READ_LIMIT,
      );
      for (let i = 0; i < events.length; i += REPLAY_BATCH_SIZE) {
        this.notify(subscriber, {
          type: "replay_events",
          events: events.slice(i, i + REPLAY_BATCH_SIZE),
        });
      }
      this.notify(subscriber, { type: "replay_done" });
    }
    for (const event of this.runEvents) {
      this.notify(subscriber, event);
    }
    this.notify(subscriber, {
      type: "run_status",
      active: this.projector.isRunActive(),
    });
  }

  private async startRun(
    executor: (onEvent: CoreEventHandler) => Promise<void>,
  ): Promise<void> {
    if (this.running) {
      throw new ConflictError(`Session "${this.sessionId}" is already running`);
    }
    this.running = true;
    this.runEvents = [];
    this.projector.resetRun();
    this.projector.setOwnRun(true);
    try {
      await executor((event) => {
        if (this.state !== "open") return;
        const enriched = this.projector.enrich(event);
        this.recordRunEvent(enriched);
        this.publish(enriched);
      });
    } finally {
      this.running = false;
      this.runEvents = [];
      this.projector.setOwnRun(false);
      this.projector.clearPendingEcho();
      this.cleanupIfIdle();
    }
  }

  private recordRunEvent(event: CoreEvent): void {
    if (event.type === "message_end" && this.dropCompletedMessage(event)) {
      return;
    }
    if (event.type === "message_update") {
      for (let i = this.runEvents.length - 1; i >= 0; i--) {
        if (
          this.runEvents[i].type === "message_start" ||
          this.runEvents[i].type === "message_end"
        ) {
          break;
        }
        if (this.runEvents[i].type === "message_update") {
          this.runEvents[i] = event;
          return;
        }
      }
    }
    if (event.type === "tool_execution_update") {
      for (let i = this.runEvents.length - 1; i >= 0; i--) {
        const previous = this.runEvents[i];
        if (
          previous.type === "tool_execution_update" &&
          previous.toolCallId === event.toolCallId
        ) {
          this.runEvents[i] = event;
          return;
        }
        if (
          previous.type === "tool_execution_start" &&
          previous.toolCallId === event.toolCallId
        ) {
          break;
        }
      }
    }
    this.runEvents.push(event);
  }

  private dropCompletedMessage(event: CoreEvent): boolean {
    const message = (event as { message?: { role?: string; toolCallId?: string } }).message;
    const messageId = (event as { messageId?: string }).messageId;
    if (!message) return false;
    if (message.role === "toolResult" && message.toolCallId !== undefined) {
      const toolCallId = message.toolCallId;
      this.runEvents = this.runEvents.filter((item) => {
        const itemMessage = (item as { message?: { role?: string; toolCallId?: string } }).message;
        if (itemMessage?.role === "toolResult" && itemMessage.toolCallId === toolCallId) {
          return false;
        }
        return (item as { toolCallId?: string }).toolCallId !== toolCallId;
      });
      return true;
    }
    if (message.role !== "user" && (event as { seq?: number }).seq === undefined) {
      return false;
    }
    if (messageId === undefined) return false;
    this.runEvents = this.runEvents.filter(
      (item) => (item as { messageId?: string }).messageId !== messageId,
    );
    return true;
  }

  private publish(event: unknown): void {
    if (this.state !== "open") return;
    for (const subscriber of this.subscribers) {
      this.notify(subscriber, event);
    }
  }

  private notify(subscriber: Subscriber, event: unknown): void {
    try {
      subscriber(event);
    } catch (err) {
      this.logger.debug(
        { err, sessionId: this.sessionId },
        "chat session subscriber failed",
      );
    }
  }
}
