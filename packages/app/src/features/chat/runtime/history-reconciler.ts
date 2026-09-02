import type { ApiClient } from "../../../lib/api";
import type { AgentEvent } from "../model/agent-event-parse";
import {
  mergeHistoryMessages,
  parseHistoryMessages,
} from "../model/chat-history";
import { reduceSessionEvents } from "../model/chat-session-reducer";
import type { ChatSessionRuntimeState } from "./chat-session-runtime";
import { COVERAGE_MAX_PAGES, resolveHistoryLowWater } from "./history-actions";

const RECONCILE_BACKOFFS = [1000, 2000, 5000];

export interface HistoryReconcilerCallbacks<T extends ChatSessionRuntimeState> {
  isCurrent(): boolean;
  getSession(): T | undefined;
  updateSession(updater: (session: T) => T): void;
  applyEvents(events: AgentEvent[]): void;
  setStreaming(streaming: boolean): void;
}

export class HistoryReconciler<T extends ChatSessionRuntimeState> {
  private buffered: AgentEvent[] = [];
  private reconciling = false;
  private historyWasReady = false;

  constructor(private readonly callbacks: HistoryReconcilerCallbacks<T>) {}

  shouldBuffer(): boolean {
    return this.reconciling;
  }

  buffer(event: AgentEvent): void {
    this.buffered.push(event);
  }

  flushBuffered(): void {
    if (this.buffered.length === 0) return;
    this.callbacks.applyEvents(this.buffered.splice(0));
  }

  onOpen(): void {
    this.historyWasReady = this.callbacks.getSession()?.historyStatus === "ready";
    this.reconciling = true;
  }

  applyClosedState(session: T): T {
    if (session.historyStatus !== "syncing") return session;
    return { ...session, historyStatus: this.historyWasReady ? "ready" : "pending" };
  }

  async reconcile(
    client: ApiClient,
    agentId: string,
    sessionId: string,
  ): Promise<void> {
    let succeeded = false;
    try {
      for (let attempt = 0; attempt <= RECONCILE_BACKOFFS.length; attempt++) {
        try {
          const result = await client.getSessionMessagesPage(
            agentId,
            sessionId,
            { limit: 20 },
          );
          if (!this.callbacks.isCurrent()) return;
          const preMergeSession = this.callbacks.getSession();
          if (!preMergeSession) return;
          const lowWater = resolveHistoryLowWater(preMergeSession);
          const historyMessages = parseHistoryMessages(result.entries);
          this.callbacks.updateSession((session) => {
            const reconciled = {
              ...session,
              messages: mergeHistoryMessages(session.messages, historyMessages),
              hasMore: result.hasMore,
              oldestLoadedId: result.oldestId,
              historyStatus: "ready" as const,
              historyError: false,
            };
            return {
              ...reconciled,
              ...reduceSessionEvents(
                reconciled,
                this.buffered.splice(0),
                Date.now(),
              ),
            };
          });
          await this.coverLoadedWindow(client, agentId, sessionId, lowWater);
          succeeded = true;
          return;
        } catch (err) {
          console.warn(
            "[history-reconciler] failed to reconcile session history:",
            err,
          );
          if (!this.callbacks.isCurrent()) return;
          if (attempt < RECONCILE_BACKOFFS.length) {
            await new Promise((r) => setTimeout(r, RECONCILE_BACKOFFS[attempt]));
            if (!this.callbacks.isCurrent()) return;
            continue;
          }
          this.flushBuffered();
          this.callbacks.updateSession((session) => ({
            ...session,
            historyStatus: this.historyWasReady ? "ready" : "pending",
            historyError: !this.historyWasReady,
          }));
        }
      }
    } finally {
      this.reconciling = false;
      const session = this.callbacks.getSession();
      if (this.callbacks.isCurrent() && session && (succeeded || this.historyWasReady)) {
        this.callbacks.setStreaming(session.streaming);
      }
    }
  }

  private async coverLoadedWindow(
    client: ApiClient,
    agentId: string,
    sessionId: string,
    lowWater: number | null,
  ): Promise<void> {
    if (lowWater === null) return;
    for (let page = 0; page < COVERAGE_MAX_PAGES; page++) {
      const session = this.callbacks.getSession();
      if (!this.callbacks.isCurrent() || !session) return;
      if (!session.hasMore || session.oldestLoadedId === null) return;
      if (session.oldestLoadedId <= lowWater) return;
      let result;
      try {
        result = await client.getSessionMessagesPage(agentId, sessionId, {
          limit: 20,
          before: session.oldestLoadedId,
        });
      } catch (err) {
        console.warn(
          "[history-reconciler] failed to cover loaded window:",
          err,
        );
        return;
      }
      if (!this.callbacks.isCurrent()) return;
      if (result.entries.length === 0) return;
      const olderMessages = parseHistoryMessages(result.entries);
      this.callbacks.updateSession((current) => {
        const merged = {
          ...current,
          messages: mergeHistoryMessages(current.messages, olderMessages),
          hasMore: result.hasMore,
          oldestLoadedId: result.oldestId,
        };
        return {
          ...merged,
          ...reduceSessionEvents(merged, this.buffered.splice(0), Date.now()),
        };
      });
    }
  }
}
