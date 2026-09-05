import type { SessionEvent } from "@spherse/core";

export type ProjectedWireEvent = { type: string } & Record<string, unknown>;

export class ChatWireProjector {
  private pendingClientId?: string;
  private messageSeqByRef = new WeakMap<object, number>();
  private currentMessageId?: string;
  private messageCounter = 0;
  private lastTurnEndSeq?: number;
  private openTurn = false;
  private ownRun = false;

  resetRun(): void {
    this.messageSeqByRef = new WeakMap();
    this.currentMessageId = undefined;
    this.messageCounter = 0;
    this.lastTurnEndSeq = undefined;
  }

  isRunActive(): boolean {
    return this.openTurn;
  }

  markRunActive(): void {
    this.openTurn = true;
  }

  setOwnRun(active: boolean): void {
    this.ownRun = active;
  }

  markPendingEcho(clientId: string): void {
    this.pendingClientId = clientId;
  }

  discardPendingEcho(clientId: string): void {
    if (this.pendingClientId === clientId) {
      this.pendingClientId = undefined;
    }
  }

  clearPendingEcho(): void {
    this.pendingClientId = undefined;
  }

  consumeLogEvent(event: SessionEvent): ProjectedWireEvent | undefined {
    switch (event.type) {
      case "user/message": {
        const clientId = this.pendingClientId;
        this.pendingClientId = undefined;
        return {
          type: "user_message",
          seq: event.seq,
          message: event.data.message,
          ...(clientId !== undefined ? { clientId } : {}),
          ...(event.data.source !== undefined ? { source: event.data.source } : {}),
          ...(event.data.triggerName !== undefined
            ? { triggerName: event.data.triggerName }
            : {}),
        };
      }
      case "turn/retried":
        return {
          type: "turn_retried",
          seq: event.seq,
          abandonedSeqs: event.data.abandonedSeqs,
        };
      case "assistant/message":
      case "tool/result": {
        const message = event.data.message as object;
        this.messageSeqByRef.set(message, event.seq);
        if (this.ownRun) return undefined;
        return { type: "message_end", message, seq: event.seq };
      }
      case "turn/start":
        if (this.openTurn) return undefined;
        this.openTurn = true;
        return { type: "run_status", active: true };
      case "turn/end": {
        this.lastTurnEndSeq = event.seq;
        if (!this.openTurn) return undefined;
        this.openTurn = false;
        return { type: "run_status", active: false };
      }
      default:
        return undefined;
    }
  }

  enrich<T>(event: T): T {
    const type = (event as { type?: unknown }).type;
    if (type === "message_start") {
      this.messageCounter += 1;
      this.currentMessageId = `m${this.messageCounter}`;
      return { ...(event as object), messageId: this.currentMessageId } as T;
    }
    if (type === "message_update") {
      return this.currentMessageId === undefined
        ? event
        : ({ ...(event as object), messageId: this.currentMessageId } as T);
    }
    if (type === "message_end") {
      const message = (event as { message?: unknown }).message;
      const seq = this.messageSeqByRef.get(message as object);
      const messageId = this.currentMessageId;
      this.currentMessageId = undefined;
      return {
        ...(event as object),
        ...(messageId !== undefined ? { messageId } : {}),
        ...(seq !== undefined ? { seq } : {}),
      } as T;
    }
    if (type === "agent_end") {
      return this.lastTurnEndSeq === undefined
        ? event
        : ({ ...(event as object), seq: this.lastTurnEndSeq } as T);
    }
    return event;
  }
}
