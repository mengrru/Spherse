import type { SendMessageMeta, SessionManager } from "@spherse/core";
import type { FastifyBaseLogger } from "fastify";
import { ChatChannel, type ChatSessionAttachment, type DetachedRunHandler } from "./chat-channel.js";

type Subscriber = (event: unknown) => void;

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
    return this.getOrCreate(projectId, runtime, agentId, sessionId).attach(
      subscriber,
      options?.since,
    );
  }

  async startDetachedRun(
    projectId: string,
    runtime: SessionManager,
    agentId: string,
    sessionId: string,
    content: string,
  ): Promise<void> {
    return this.getOrCreate(projectId, runtime, agentId, sessionId).startDetachedRun(content);
  }

  async startRunWithMeta(
    projectId: string,
    runtime: SessionManager,
    agentId: string,
    sessionId: string,
    content: string,
    meta: SendMessageMeta,
    onEvent?: DetachedRunHandler,
  ): Promise<void> {
    return this.getOrCreate(projectId, runtime, agentId, sessionId).startDetachedRun(content, {
      meta,
      awaitRun: true,
      ...(onEvent !== undefined ? { onEvent } : {}),
    });
  }

  private getOrCreate(
    projectId: string,
    runtime: SessionManager,
    agentId: string,
    sessionId: string,
  ): ChatChannel {
    const key = `${projectId}:${sessionId}`;
    const existing = this.channels.get(key);
    if (existing) return existing;

    const channel = ChatChannel.open(runtime, this.logger, agentId, sessionId, () => {
      if (this.channels.get(key) === channel) {
        this.channels.delete(key);
      }
    });
    this.channels.set(key, channel);
    return channel;
  }
}
