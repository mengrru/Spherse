import type { ChatReplayEvent, SessionMessagesPageResponse } from "@spherse/contracts";
import type { AgentEvent } from "../model/agent-event-parse";
import type { DecodedFrame } from "./decode";

export type HistoryStatus = "pending" | "syncing" | "ready";

export interface RecoveryHost {
  fetchPage(): Promise<SessionMessagesPageResponse>;
  applyPage(page: SessionMessagesPageResponse): void;
  applyPersistedEvents(events: ChatReplayEvent[]): void;
  finishReplay(): void;
  emitEvents(events: AgentEvent[]): void;
  setHistory(status: HistoryStatus, error: boolean): void;
  getHistoryStatus(): HistoryStatus;
  isAlive(): boolean;
}

export interface SessionRecovery {
  onOpen(since: number | undefined): void;
  onFrame(frame: DecodedFrame): boolean;
  onClose(): void;
  cancel(): void;
}

const RECONCILE_BACKOFFS = [1000, 2000, 5000] as const;

type RecoveryMode = "idle" | "awaiting-first-frame" | "http-sync" | "replay" | "live";

export function createSessionRecovery(host: RecoveryHost): SessionRecovery {
  let generation = 0;
  let mode: RecoveryMode = "idle";
  let buffered: AgentEvent[] = [];
  let replayBuffered: AgentEvent[] = [];
  let timer: ReturnType<typeof setTimeout> | undefined;
  let wasReady = false;
  let sentSince: number | undefined;

  const clearTimer = () => {
    if (timer === undefined) return;
    clearTimeout(timer);
    timer = undefined;
  };

  const flushBuffered = () => {
    const events = buffered;
    buffered = [];
    if (events.length > 0) host.emitEvents(events);
  };

  const flushReplayBuffered = () => {
    const events = replayBuffered;
    replayBuffered = [];
    if (events.length > 0) host.emitEvents(events);
  };

  const runHttpSync = async (gen: number) => {
    for (let attempt = 0; attempt <= RECONCILE_BACKOFFS.length; attempt++) {
      if (gen !== generation || !host.isAlive()) return;
      try {
        const page = await host.fetchPage();
        if (gen !== generation || !host.isAlive()) return;
        host.applyPage(page);
        flushBuffered();
        host.setHistory("ready", false);
        mode = "live";
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
        flushBuffered();
        host.setHistory(wasReady ? "ready" : "pending", !wasReady);
        mode = "live";
        return;
      }
    }
  };

  const startHttpSync = (gen: number) => {
    mode = "http-sync";
    void runHttpSync(gen);
  };

  return {
    onOpen(since) {
      generation += 1;
      sentSince = since;
      wasReady = host.getHistoryStatus() === "ready";
      host.setHistory("syncing", false);
      buffered = [];
      replayBuffered = [];
      if (since === undefined) {
        startHttpSync(generation);
        return;
      }
      mode = "awaiting-first-frame";
    },

    onFrame(frame) {
      switch (mode) {
        case "awaiting-first-frame": {
          if (frame.kind === "session-ready") {
            if (sentSince !== undefined && frame.replay) {
              mode = "replay";
            } else {
              startHttpSync(generation);
            }
            return true;
          }
          if (frame.kind === "event") buffered.push(frame.event);
          startHttpSync(generation);
          return true;
        }
        case "http-sync": {
          if (frame.kind === "event") buffered.push(frame.event);
          return true;
        }
        case "replay": {
          if (frame.kind === "replay-events") {
            host.applyPersistedEvents(frame.events);
            return true;
          }
          if (frame.kind === "replay-done") {
            mode = "live";
            host.finishReplay();
            flushReplayBuffered();
            host.setHistory("ready", false);
            return true;
          }
          if (frame.kind === "event") replayBuffered.push(frame.event);
          return true;
        }
        case "live": {
          if (frame.kind === "replay-events") {
            host.applyPersistedEvents(frame.events);
            return true;
          }
          return false;
        }
        default:
          return false;
      }
    },

    onClose() {
      clearTimer();
      generation += 1;
      const previous = mode;
      mode = "idle";
      if (previous === "http-sync" || previous === "awaiting-first-frame") {
        flushBuffered();
        host.setHistory(wasReady ? "ready" : "pending", false);
      } else if (previous === "replay") {
        flushReplayBuffered();
        host.setHistory(wasReady ? "ready" : "pending", false);
      }
    },

    cancel() {
      clearTimer();
      generation += 1;
      mode = "idle";
      buffered = [];
      replayBuffered = [];
    },
  };
}
