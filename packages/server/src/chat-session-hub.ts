import { ConflictError, type Attachment, type SessionManager } from "@spherse/core";
import type { FastifyBaseLogger } from "fastify";
import { classifyRunError } from "./classify-run-error.js";

type CoreEventHandler = Parameters<SessionManager["sendMessage"]>[3];
type CoreEvent = Parameters<CoreEventHandler>[0];
type Subscriber = (event: unknown) => void;

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
}

export interface ChatSessionAttachment {
  ready: Promise<boolean>;
  sendMessage(content: string, attachments?: Attachment[]): Promise<void>;
  retryLastTurn(): Promise<void>;
  abort(): void;
  resolveControlRequest(
    requestId: string,
    decision: { approved: boolean; reason?: string },
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
      for (const event of channel.runEvents) {
        this.notify(channel, subscriber, event);
      }
      this.notify(channel, subscriber, {
        type: "run_status",
        active: channel.running,
      });
      channel.subscribers.add(subscriber);
      subscribed = true;
      return true;
    });

    return {
      ready,
      sendMessage: async (content, attachments) => {
        if (!(await ready) || !active) return;
        await this.startRun(channel, (onEvent) =>
          channel.runtime.sendMessage(
            channel.sessionId,
            content,
            attachments ?? [],
            onEvent,
          ),
        );
      },
      retryLastTurn: async () => {
        if (!(await ready) || !active) return;
        await this.startRun(channel, (onEvent) =>
          channel.runtime.retryLastTurn(channel.sessionId, onEvent),
        );
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
    };
    channel.ready = runtime.restoreSession(agentId, sessionId)
      .then(() => {
        channel.initialized = true;
      })
      .catch((err) => {
        if (this.channels.get(key) === channel) this.channels.delete(key);
        throw err;
      })
      .finally(() => {
        this.cleanupIfIdle(channel);
      });
    this.channels.set(key, channel);
    return channel;
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
    this.publish(channel, { type: "run_status", active: true });
    try {
      await executor((event) => {
        this.recordRunEvent(channel, event);
        this.publish(channel, event);
      });
    } finally {
      channel.running = false;
      channel.runEvents = [];
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
    this.channels.delete(channel.key);
  }
}
