import { ApiError, type ApiClient } from "../../../lib/api";
import type { AgentMessage } from "@spherse/core";
import type { ReplicaFrame, ReplicaSnapshotInput, SessionReplica } from "./session-replica";

const SYNC_RETRY_BACKOFFS = [1000, 2000, 5000];
const EVENTS_PAGE_LIMIT = 200;
const SNAPSHOT_PAGE_SIZE = 20;

export type SyncKind = "initial" | "catchup" | "refresh" | "full";

export interface SyncDeps {
  client: ApiClient;
  agentId: string;
  sessionId: string;
  emit(frame: ReplicaFrame): void;
  getState(): SessionReplica | undefined;
  isRecordActive(): boolean;
}

export async function runSync(deps: SyncDeps, kind: SyncKind): Promise<void> {
  deps.emit({ type: "syncStarted" });
  try {
    if (kind !== "catchup") {
      const snapshot = await withRetries(() =>
        deps.client.getSessionMessagesPage(deps.agentId, deps.sessionId, {
          limit: SNAPSHOT_PAGE_SIZE,
        }), deps,
      );
      if (!deps.isRecordActive()) return;
      deps.emit({
        type: "snapshotApplied",
        snapshot: toSnapshotInput(snapshot),
        full: kind === "full" || kind === "initial",
      });
    }
    await catchUpEvents(deps);
    if (!deps.isRecordActive()) return;
    deps.emit({ type: "syncSucceeded" });
  } catch (err) {
    if (!deps.isRecordActive()) return;
    if (err instanceof ApiError && err.status === 410) {
      deps.emit({ type: "legacySnapshotMode" });
      if (kind === "catchup") {
        try {
          const snapshot = await withRetries(() =>
            deps.client.getSessionMessagesPage(deps.agentId, deps.sessionId, {
              limit: SNAPSHOT_PAGE_SIZE,
            }), deps,
          );
          if (!deps.isRecordActive()) return;
          deps.emit({
            type: "snapshotApplied",
            snapshot: toSnapshotInput(snapshot),
            full: false,
          });
        } catch (snapshotErr) {
          void snapshotErr;
        }
      }
      deps.emit({ type: "syncSucceeded" });
      return;
    }
    deps.emit({ type: "syncFailed" });
  }
}

function toSnapshotInput(snapshot: { entries: Array<{ id: number; message: unknown; source?: "triggered"; triggerName?: string }>; hasMore: boolean; oldestId: number | null }): ReplicaSnapshotInput {
  return {
    entries: snapshot.entries.map((entry) => ({
      id: entry.id,
      message: entry.message as AgentMessage,
      ...(entry.source !== undefined ? { source: entry.source } : {}),
      ...(entry.triggerName !== undefined ? { triggerName: entry.triggerName } : {}),
    })),
    hasMore: snapshot.hasMore,
    oldestId: snapshot.oldestId,
  };
}

async function catchUpEvents(deps: SyncDeps): Promise<void> {
  const highSeq = deps.getState()?.durable.highSeq;
  let since = highSeq ?? -1;
  for (;;) {
    const result = await withRetries(() =>
      deps.client.getSessionEvents(deps.agentId, deps.sessionId, {
        since,
        limit: EVENTS_PAGE_LIMIT,
      }), deps,
    );
    if (!deps.isRecordActive()) return;
    for (const frame of result.events) {
      deps.emit(frame);
    }
    if (!result.hasMore || result.events.length === 0) return;
    since = frameCursor(result.events[result.events.length - 1]);
  }
}

function frameCursor(frame: { type: string; seq?: number; upTo?: number }): number {
  if (frame.type === "turn_withdrawn") return frame.upTo ?? (frame.seq ?? 0) + 1;
  return frame.seq ?? -1;
}

async function withRetries<T>(fn: () => Promise<T>, deps: SyncDeps): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof ApiError && err.status === 410) throw err;
      if (!deps.isRecordActive()) throw err;
      if (attempt >= SYNC_RETRY_BACKOFFS.length) throw err;
      await new Promise((resolve) => setTimeout(resolve, SYNC_RETRY_BACKOFFS[attempt]));
      if (!deps.isRecordActive()) throw err;
    }
  }
}
