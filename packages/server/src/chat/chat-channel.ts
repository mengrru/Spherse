import {
  ConflictError,
  type Attachment,
  type SendMessageMeta,
  type SessionManager,
} from "@spherse/core";
import type { FastifyBaseLogger } from "fastify";
import { classifyRunError } from "./classify-run-error.js";
import { ChatWireProjector } from "./chat-wire-projector.js";

type CoreEventHandler = Parameters<SessionManager["sendMessage"]>[3];
export type DetachedRunHandler = CoreEventHandler;
type CoreEvent = Parameters<CoreEventHandler>[0];
type Subscriber = (event: unknown) => void;

const REPLAY_BATCH_SIZE = 200;
const REPLAY_READ_LIMIT = Number.MAX_SAFE_INTEGER;

export type ControlRequestDecision =
  | { approved: boolean; reason?: string }
  | { answer?: string; timedOut: boolean };

export interface ChatSessionAttachment {
  ready: Promise<boolean>;
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
  readonly ready: Promise<void>;
  private initialized = false;
  private attachments = 0;
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
  ) {
    this.ready = runtime.restoreSession(agentId, sessionId)
      .then(() => {
        this.initialized = true;
        this.logUnsubscribe = this.subscribeLog() ?? undefined;
      })
      .catch((err) => {
        this.release();
        throw err;
      })
      .finally(() => {
        this.cleanupIfIdle();
      });
  }

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
    this.attachments += 1;
    let active = true;
    let subscribed = false;

    const ready = this.ready.then(() => {
      if (!active) return false;
      this.handshake(subscriber, since);
      this.subscribers.add(subscriber);
      subscribed = true;
      return true;
    });

    return {
      ready,
      sendMessage: async (content, attachments, clientId) => {
        if (!(await ready) || !active) return;
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
        if (!(await ready) || !active) return;
        await this.startRun((onEvent) =>
          this.runtime.retryLastTurn(this.sessionId, onEvent),
        );
      },
      withdrawLastTurn: async () => {
        if (!(await ready) || !active) return;
        if (this.running) {
          throw new ConflictError(`Session "${this.sessionId}" is already running`);
        }
        const seq = await this.runtime.withdrawLastTurn(this.sessionId);
        this.publish({ type: "turn_withdrawn", seq });
      },
      abort: () => {
        if (active) this.runtime.abortSession(this.sessionId);
      },
      resolveControlRequest: (requestId, decision) => {
        if (active) {
          this.runtime.resolveControlRequest(this.sessionId, requestId, decision);
        }
      },
      close: () => {
        if (!active) return;
        active = false;
        this.attachments = Math.max(0, this.attachments - 1);
        if (subscribed) this.subscribers.delete(subscriber);
        this.cleanupIfIdle();
      },
    };
  }

  async startDetachedRun(
    content: string,
    options?: {
      meta?: SendMessageMeta;
      onEvent?: DetachedRunHandler;
      awaitRun?: boolean;
    },
  ): Promise<void> {
    this.attachments += 1;
    try {
      await this.ready;
      if (this.running) {
        throw new ConflictError(`Session "${this.sessionId}" is already running`);
      }
    } catch (err) {
      this.attachments -= 1;
      this.cleanupIfIdle();
      throw err;
    }
    const executor = (broadcast: CoreEventHandler) => {
      const fanOut = (event: CoreEvent) => {
        options?.onEvent?.(event);
        broadcast(event);
      };
      if (options?.meta !== undefined) {
        return this.runtime.sendMessage(this.sessionId, content, [], fanOut, options.meta);
      }
      return this.runtime.sendMessage(this.sessionId, content, [], fanOut);
    };
    const handleFailure = (err: unknown) => {
      this.logger.error({ err, sessionId: this.sessionId }, "detached chat run failed");
      this.publish({
        type: "error",
        message: err instanceof Error ? err.message : "chat error",
        code: classifyRunError(err),
      });
    };
    const release = () => {
      this.attachments -= 1;
      this.cleanupIfIdle();
    };
    if (options?.awaitRun) {
      return this.startRun(executor)
        .catch((err: unknown) => {
          handleFailure(err);
          throw err;
        })
        .finally(release);
    }
    void this.startRun(executor)
      .catch(handleFailure)
      .finally(release);
  }

  private release(): void {
    this.logUnsubscribe?.();
    this.logUnsubscribe = undefined;
    this.dispose();
  }

  private subscribeLog(): (() => void) | null {
    return this.runtime.subscribeSessionEvents(this.sessionId, (event) => {
      const wireEvent = this.projector.consumeLogEvent(event);
      if (wireEvent !== undefined) {
        this.publish(wireEvent);
      }
    });
  }

  private handshake(subscriber: Subscriber, since: number | undefined): void {
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
      active: this.running,
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
    this.publish({ type: "run_status", active: true });
    try {
      await executor((event) => {
        const enriched = this.projector.enrich(event);
        this.recordRunEvent(enriched);
        this.publish(enriched);
      });
    } finally {
      this.running = false;
      this.runEvents = [];
      this.projector.clearPendingEcho();
      this.publish({ type: "run_status", active: false });
      this.cleanupIfIdle();
    }
  }

  private recordRunEvent(event: CoreEvent): void {
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

  private publish(event: unknown): void {
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

  private cleanupIfIdle(): void {
    if (!this.initialized || this.running || this.attachments > 0) {
      return;
    }
    this.runtime.destroySession(this.sessionId);
    this.release();
  }
}
