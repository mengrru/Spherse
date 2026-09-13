import type { SessionMessagesPageResponse } from "@spherse/contracts";
import type { AgentEvent } from "../model/agent-event-parse";

export interface RecoveryHost {
  fetchPage(): Promise<SessionMessagesPageResponse>;
  applyPage(page: SessionMessagesPageResponse): void;
  emitEvents(events: AgentEvent[]): void;
  setHistory(status: "pending" | "syncing" | "ready", error: boolean): void;
  getHistoryStatus(): "pending" | "syncing" | "ready";
  isAlive(): boolean;
}

export interface SessionRecovery {
  onOpen(): void;
  onFrame(event: AgentEvent): boolean;
  onClose(): void;
  cancel(): void;
}

const RECONCILE_BACKOFFS = [1000, 2000, 5000] as const;

export function createHttpRecovery(host: RecoveryHost): SessionRecovery {
  let generation = 0;
  let buffering = false;
  let buffer: AgentEvent[] = [];
  let timer: ReturnType<typeof setTimeout> | undefined;
  let wasReady = false;

  const clearTimer = () => {
    if (timer === undefined) return;
    clearTimeout(timer);
    timer = undefined;
  };

  const flush = () => {
    buffering = false;
    const events = buffer;
    buffer = [];
    if (events.length > 0) host.emitEvents(events);
  };

  const run = async (gen: number) => {
    for (let attempt = 0; attempt <= RECONCILE_BACKOFFS.length; attempt++) {
      if (gen !== generation || !host.isAlive()) return;
      try {
        const page = await host.fetchPage();
        if (gen !== generation || !host.isAlive()) return;
        host.applyPage(page);
        flush();
        host.setHistory("ready", false);
        return;
      } catch (err) {
        if (gen !== generation || !host.isAlive()) return;
        console.warn("[chat-session-recovery] failed to reconcile session history:", err);
        if (attempt < RECONCILE_BACKOFFS.length) {
          await new Promise<void>((resolve) => {
            timer = setTimeout(() => {
              timer = undefined;
              resolve();
            }, RECONCILE_BACKOFFS[attempt]);
          });
          continue;
        }
        flush();
        host.setHistory(wasReady ? "ready" : "pending", !wasReady);
        return;
      }
    }
  };

  return {
    onOpen() {
      generation += 1;
      const gen = generation;
      buffering = true;
      buffer = [];
      wasReady = host.getHistoryStatus() === "ready";
      host.setHistory("syncing", false);
      void run(gen);
    },

    onFrame(event) {
      if (!buffering) return false;
      buffer.push(event);
      return true;
    },

    onClose() {
      clearTimer();
      generation += 1;
      if (!buffering) return;
      flush();
      host.setHistory(wasReady ? "ready" : "pending", false);
    },

    cancel() {
      clearTimer();
      generation += 1;
      buffering = false;
      buffer = [];
    },
  };
}
