import type { SessionEvent } from "@spherse/core";

export interface SessionEventSource {
  getSessionLastSeq(agentId: string, sessionId: string): number;
  readSessionEventsAfter(
    agentId: string,
    sessionId: string,
    sinceSeq: number,
    limit: number,
  ): SessionEvent[];
}

const REPLAY_BATCH_SIZE = 200;
const REPLAY_READ_LIMIT = Number.MAX_SAFE_INTEGER;
const SCAN_PAGE = 200;

export function detectOpenTurn(
  source: SessionEventSource,
  agentId: string,
  sessionId: string,
): boolean {
  const lastSeq = source.getSessionLastSeq(agentId, sessionId);
  if (lastSeq < 0) return false;
  let since = lastSeq - SCAN_PAGE;
  for (;;) {
    const events = source.readSessionEventsAfter(agentId, sessionId, since, SCAN_PAGE);
    if (events.length === 0) return false;
    for (let i = events.length - 1; i >= 0; i--) {
      if (events[i].type === "turn/end") return false;
      if (events[i].type === "turn/start") return true;
    }
    const oldest = events[0].seq;
    if (oldest <= 0) return false;
    since = oldest - 1 - SCAN_PAGE;
  }
}

export interface ReplayHandshakeArgs {
  source: SessionEventSource;
  agentId: string;
  sessionId: string;
  since: number | undefined;
  snapshot: readonly unknown[];
  runActive: boolean;
  notify: (event: unknown) => void;
}

export function replayHandshake(args: ReplayHandshakeArgs): void {
  const { source, agentId, sessionId, since, snapshot, runActive, notify } = args;
  const lastSeq = source.getSessionLastSeq(agentId, sessionId);
  notify({ type: "session_ready", lastSeq, replay: true });
  if (since !== undefined) {
    const events = source.readSessionEventsAfter(
      agentId,
      sessionId,
      since,
      REPLAY_READ_LIMIT,
    );
    for (let i = 0; i < events.length; i += REPLAY_BATCH_SIZE) {
      notify({ type: "replay_events", events: events.slice(i, i + REPLAY_BATCH_SIZE) });
    }
    notify({ type: "replay_done" });
  }
  for (const event of snapshot) {
    notify(event);
  }
  notify({ type: "run_status", active: runActive });
}
