import type { SessionManager } from "@spherse/core";

type CoreEventHandler = Parameters<SessionManager["sendMessage"]>[3];
type CoreEvent = Parameters<CoreEventHandler>[0];

export class RunSnapshot {
  private events: CoreEvent[] = [];

  reset(): void {
    this.events = [];
  }

  get inFlight(): readonly CoreEvent[] {
    return this.events;
  }

  record(event: CoreEvent): void {
    if (event.type === "message_end" && this.dropCompletedMessage(event)) {
      return;
    }
    if (event.type === "message_update") {
      for (let i = this.events.length - 1; i >= 0; i--) {
        if (
          this.events[i].type === "message_start" ||
          this.events[i].type === "message_end"
        ) {
          break;
        }
        if (this.events[i].type === "message_update") {
          this.events[i] = event;
          return;
        }
      }
    }
    if (event.type === "tool_execution_update") {
      for (let i = this.events.length - 1; i >= 0; i--) {
        const previous = this.events[i];
        if (
          previous.type === "tool_execution_update" &&
          previous.toolCallId === event.toolCallId
        ) {
          this.events[i] = event;
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
    this.events.push(event);
  }

  private dropCompletedMessage(event: CoreEvent): boolean {
    const message = (event as { message?: { role?: string; toolCallId?: string } }).message;
    const messageId = (event as { messageId?: string }).messageId;
    if (!message) return false;
    if (message.role === "toolResult" && message.toolCallId !== undefined) {
      const toolCallId = message.toolCallId;
      this.events = this.events.filter((item) => {
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
    this.events = this.events.filter(
      (item) => (item as { messageId?: string }).messageId !== messageId,
    );
    return true;
  }
}
