import type { SessionManager } from "@spherse/core";
import type { FastifyBaseLogger } from "fastify";
import { RuntimeClosedError } from "../errors.js";
import { ChatChannel, type ChannelCloseReason, type ChatSessionAttachment } from "./chat-channel.js";

type Subscriber = (event: unknown) => void;

export class ChatSessionHub {
  private readonly channels = new Map<SessionManager, Map<string, ChatChannel>>();
  private readonly closedRuntimes = new WeakSet<SessionManager>();
  private closed = false;

  constructor(private readonly logger: FastifyBaseLogger) {}

  attach(
    runtime: SessionManager,
    agentId: string,
    sessionId: string,
    subscriber: Subscriber,
    options?: { since?: number },
  ): ChatSessionAttachment {
    return this.getOrCreate(runtime, agentId, sessionId).attach(
      subscriber,
      options?.since,
    );
  }

  async startDetachedRun(
    runtime: SessionManager,
    agentId: string,
    sessionId: string,
    content: string,
  ): Promise<void> {
    return this.getOrCreate(runtime, agentId, sessionId).startDetachedRun(content);
  }

  closeRuntime(runtime: SessionManager): void {
    this.closedRuntimes.add(runtime);
    const bySession = this.channels.get(runtime);
    if (!bySession) return;
    this.closeChannels(bySession, "runtime-closed");
    this.channels.delete(runtime);
  }

  close(): void {
    this.closed = true;
    const entries = [...this.channels.entries()];
    for (const [runtime, bySession] of entries) {
      this.closedRuntimes.add(runtime);
      this.closeChannels(bySession, "server-closed");
    }
    this.channels.clear();
  }

  private closeChannels(
    bySession: Map<string, ChatChannel>,
    reason: ChannelCloseReason,
  ): void {
    for (const [sessionId, channel] of bySession) {
      try {
        channel.close(reason);
      } catch (err) {
        this.logger.error(
          { err, sessionId, reason },
          "chat channel close failed",
        );
      }
    }
  }

  private getOrCreate(
    runtime: SessionManager,
    agentId: string,
    sessionId: string,
  ): ChatChannel {
    if (this.closed) {
      throw new RuntimeClosedError("Server is shutting down");
    }
    if (this.closedRuntimes.has(runtime)) {
      throw new RuntimeClosedError();
    }

    let bySession = this.channels.get(runtime);
    if (!bySession) {
      bySession = new Map();
      this.channels.set(runtime, bySession);
    }
    const existing = bySession.get(sessionId);
    if (existing) return existing;

    let channel: ChatChannel | undefined;
    channel = ChatChannel.open(runtime, this.logger, agentId, sessionId, () => {
      const entries = this.channels.get(runtime);
      if (!entries || entries.get(sessionId) !== channel) return;
      entries.delete(sessionId);
      if (entries.size === 0) {
        this.channels.delete(runtime);
      }
    });
    bySession.set(sessionId, channel);
    return channel;
  }
}
