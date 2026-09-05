import {
  ConflictError,
  type Attachment,
  type SessionManager,
} from "@spherse/core";
import type { FastifyBaseLogger } from "fastify";
import { classifyRunError } from "./classify-run-error.js";

type CoreEventHandler = Parameters<SessionManager["sendMessage"]>[3];
type CoreEvent = Parameters<CoreEventHandler>[0];
type Subscriber = (event: unknown) => void;

const REPLAY_BATCH_SIZE = 200;
const REPLAY_READ_LIMIT = Number.MAX_SAFE_INTEGER;

export type ControlRequestDecision =
  | { approved: boolean; reason?: string }
  | { answer?: string; timedOut: boolean };

interface ChatChannel {
  key: string;
  runtime: SessionManager;
  agentId: string;
  sessionId: string;
  ready: Promise<void>;
  initialized: boolean;
  attachments: number;
  subscribers: Set<Subscriber>;
  running: boolean;
  runEvents: CoreEvent[];
  logUnsubscribe?: () => void;
  pendingClientId?: string;
  messageSeqByRef: WeakMap<object, number>;
  currentMessageId?: string;
  messageCounter: number;
  lastTurnEndSeq?: number;
}

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

export class ChatSessionHub {
  private readonly channels = new Map<string, ChatChannel>();

  constructor(private readonly logger: FastifyBaseLogger) {}

  attach(
    projectId: string,
    runtime: SessionManager,
    agentId: string,
    sessionId: string,
    subscriber: Subscriber,
    options?: { since?: number },
  ): ChatSessionAttachment {
    const channel = this.getOrCreateChannel(
      projectId,
      runtime,
      agentId,
      sessionId,
    );
    channel.attachments += 1;
    let active = true;
    let subscribed = false;

    const ready = channel.ready.then(() => {
      if (!active) return false;
      this.handshake(channel, subscriber, options?.since);
      channel.subscribers.add(subscriber);
      subscribed = true;
      return true;
    });

    return {
      ready,
      sendMessage: async (content, attachments, clientId) => {
        if (!(await ready) || !active) return;
        try {
          await this.startRun(channel, (onEvent) => {
            if (clientId !== undefined) channel.pendingClientId = clientId;
            return channel.runtime.sendMessage(
              channel.sessionId,
              content,
              attachments ?? [],
              onEvent,
            );
          });
        } catch (err) {
          if (clientId !== undefined && channel.pendingClientId === clientId) {
            channel.pendingClientId = undefined;
          }
          throw err;
        }
      },
      retryLastTurn: async () => {
        if (!(await ready) || !active) return;
        await this.startRun(channel, (onEvent) =>
          channel.runtime.retryLastTurn(channel.sessionId, onEvent),
        );
      },
      withdrawLastTurn: async () => {
        if (!(await ready) || !active) return;
        if (channel.running) {
          throw new ConflictError(`Session "${channel.sessionId}" is already running`);
        }
        const seq = await channel.runtime.withdrawLastTurn(channel.sessionId);
        this.publish(channel, { type: "turn_withdrawn", seq });
      },
      abort: () => {
        if (active) channel.runtime.abortSession(channel.sessionId);
      },
      resolveControlRequest: (requestId, decision) => {
        if (active) {
          channel.runtime.resolveControlRequest(
            channel.sessionId,
            requestId,
            decision,
          );
        }
      },
      close: () => {
        if (!active) return;
        active = false;
        channel.attachments = Math.max(0, channel.attachments - 1);
        if (subscribed) channel.subscribers.delete(subscriber);
        this.cleanupIfIdle(channel);
      },
    };
  }

  async startDetachedRun(
    projectId: string,
    runtime: SessionManager,
    agentId: string,
    sessionId: string,
    content: string,
  ): Promise<void> {
    const channel = this.getOrCreateChannel(projectId, runtime, agentId, sessionId);
    channel.attachments += 1;
    try {
      await channel.ready;
      if (channel.running) {
        throw new ConflictError(`Session "${sessionId}" is already running`);
      }
    } catch (err) {
      channel.attachments -= 1;
      this.cleanupIfIdle(channel);
      throw err;
    }
    this.startRun(channel, (onEvent) =>
      channel.runtime.sendMessage(sessionId, content, [], onEvent),
    )
      .catch((err) => {
        this.logger.error({ err, sessionId }, "detached chat run failed");
        this.publish(channel, {
          type: "error",
          message: err instanceof Error ? err.message : "chat error",
          code: classifyRunError(err),
        });
      })
      .finally(() => {
        channel.attachments -= 1;
        this.cleanupIfIdle(channel);
      });
  }

  private getOrCreateChannel(
    projectId: string,
    runtime: SessionManager,
    agentId: string,
    sessionId: string,
  ): ChatChannel {
    const key = `${projectId}:${sessionId}`;
    const existing = this.channels.get(key);
    if (existing) return existing;

    const channel: ChatChannel = {
      key,
      runtime,
      agentId,
      sessionId,
      ready: Promise.resolve(),
      initialized: false,
      attachments: 0,
      subscribers: new Set(),
      running: false,
      runEvents: [],
      messageSeqByRef: new WeakMap(),
      messageCounter: 0,
    };
    channel.ready = runtime.restoreSession(agentId, sessionId)
      .then(() => {
        channel.initialized = true;
        channel.logUnsubscribe = this.subscribeLog(channel) ?? undefined;
      })
      .catch((err) => {
        if (this.channels.get(key) === channel) this.deleteChannel(channel);
        throw err;
      })
      .finally(() => {
        this.cleanupIfIdle(channel);
      });
    this.channels.set(key, channel);
    return channel;
  }

  private subscribeLog(channel: ChatChannel): (() => void) | null {
    return channel.runtime.subscribeSessionEvents(channel.sessionId, (event) => {
      switch (event.type) {
        case "user/message": {
          const clientId = channel.pendingClientId;
          channel.pendingClientId = undefined;
          this.publish(channel, {
            type: "user_message",
            seq: event.seq,
            message: event.data.message,
            ...(clientId !== undefined ? { clientId } : {}),
            ...(event.data.source !== undefined ? { source: event.data.source } : {}),
            ...(event.data.triggerName !== undefined
              ? { triggerName: event.data.triggerName }
              : {}),
          });
          break;
        }
        case "turn/retried":
          this.publish(channel, {
            type: "turn_retried",
            seq: event.seq,
            abandonedSeqs: event.data.abandonedSeqs,
          });
          break;
        case "assistant/message":
        case "tool/result":
          channel.messageSeqByRef.set(event.data.message as object, event.seq);
          break;
        case "turn/end":
          channel.lastTurnEndSeq = event.seq;
          break;
        default:
          break;
      }
    });
  }

  private handshake(
    channel: ChatChannel,
    subscriber: Subscriber,
    since: number | undefined,
  ): void {
    const lastSeq = channel.runtime.getSessionLastSeq(channel.agentId, channel.sessionId);
    this.notify(channel, subscriber, {
      type: "session_ready",
      lastSeq,
      replay: true,
    });
    if (since !== undefined) {
      const events = channel.runtime.readSessionEventsAfter(
        channel.agentId,
        channel.sessionId,
        since,
        REPLAY_READ_LIMIT,
      );
      for (let i = 0; i < events.length; i += REPLAY_BATCH_SIZE) {
        this.notify(channel, subscriber, {
          type: "replay_events",
          events: events.slice(i, i + REPLAY_BATCH_SIZE),
        });
      }
      this.notify(channel, subscriber, { type: "replay_done" });
    }
    for (const event of channel.runEvents) {
      this.notify(channel, subscriber, event);
    }
    this.notify(channel, subscriber, {
      type: "run_status",
      active: channel.running,
    });
  }

  private enrichWireEvent(channel: ChatChannel, event: CoreEvent): CoreEvent {
    if (event.type === "message_start") {
      channel.messageCounter += 1;
      channel.currentMessageId = `m${channel.messageCounter}`;
      return { ...event, messageId: channel.currentMessageId } as CoreEvent;
    }
    if (event.type === "message_update") {
      return channel.currentMessageId === undefined
        ? event
        : ({ ...event, messageId: channel.currentMessageId } as CoreEvent);
    }
    if (event.type === "message_end") {
      const seq = channel.messageSeqByRef.get(event.message as object);
      const messageId = channel.currentMessageId;
      channel.currentMessageId = undefined;
      const enriched = {
        ...event,
        ...(messageId !== undefined ? { messageId } : {}),
        ...(seq !== undefined ? { seq } : {}),
      };
      return enriched as CoreEvent;
    }
    if (event.type === "agent_end") {
      return channel.lastTurnEndSeq === undefined
        ? event
        : ({ ...event, seq: channel.lastTurnEndSeq } as CoreEvent);
    }
    return event;
  }

  private deleteChannel(channel: ChatChannel): void {
    channel.logUnsubscribe?.();
    channel.logUnsubscribe = undefined;
    this.channels.delete(channel.key);
  }

  private async startRun(
    channel: ChatChannel,
    executor: (onEvent: CoreEventHandler) => Promise<void>,
  ): Promise<void> {
    if (channel.running) {
      throw new ConflictError(`Session "${channel.sessionId}" is already running`);
    }
    channel.running = true;
    channel.runEvents = [];
    channel.messageSeqByRef = new WeakMap();
    channel.currentMessageId = undefined;
    channel.messageCounter = 0;
    channel.lastTurnEndSeq = undefined;
    this.publish(channel, { type: "run_status", active: true });
    try {
      await executor((event) => {
        const enriched = this.enrichWireEvent(channel, event);
        this.recordRunEvent(channel, enriched);
        this.publish(channel, enriched);
      });
    } finally {
      channel.running = false;
      channel.runEvents = [];
      channel.pendingClientId = undefined;
      this.publish(channel, { type: "run_status", active: false });
      this.cleanupIfIdle(channel);
    }
  }

  private recordRunEvent(channel: ChatChannel, event: CoreEvent): void {
    if (event.type === "message_update") {
      for (let i = channel.runEvents.length - 1; i >= 0; i--) {
        if (
          channel.runEvents[i].type === "message_start" ||
          channel.runEvents[i].type === "message_end"
        ) {
          break;
        }
        if (channel.runEvents[i].type === "message_update") {
          channel.runEvents[i] = event;
          return;
        }
      }
    }
    if (event.type === "tool_execution_update") {
      for (let i = channel.runEvents.length - 1; i >= 0; i--) {
        const previous = channel.runEvents[i];
        if (
          previous.type === "tool_execution_update" &&
          previous.toolCallId === event.toolCallId
        ) {
          channel.runEvents[i] = event;
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
    channel.runEvents.push(event);
  }

  private publish(channel: ChatChannel, event: unknown): void {
    for (const subscriber of channel.subscribers) {
      this.notify(channel, subscriber, event);
    }
  }

  private notify(
    channel: ChatChannel,
    subscriber: Subscriber,
    event: unknown,
  ): void {
    try {
      subscriber(event);
    } catch (err) {
      this.logger.debug(
        { err, sessionId: channel.sessionId },
        "chat session subscriber failed",
      );
    }
  }

  private cleanupIfIdle(channel: ChatChannel): void {
    if (
      !channel.initialized ||
      channel.running ||
      channel.attachments > 0 ||
      this.channels.get(channel.key) !== channel
    ) {
      return;
    }
    channel.runtime.destroySession(channel.sessionId);
    this.deleteChannel(channel);
  }
}
