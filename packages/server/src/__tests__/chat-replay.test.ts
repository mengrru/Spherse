import { describe, expect, it, vi } from "vitest";
import { detectOpenTurn, replayHandshake } from "../chat/chat-replay.js";

interface FakeEvent {
  type: string;
  seq: number;
  time: number;
  data: Record<string, unknown>;
}

function createSource(events: FakeEvent[]) {
  const getSessionLastSeq = vi.fn(() => (events.length > 0 ? events[events.length - 1].seq : -1));
  const readSessionEventsAfter = vi.fn(
    (_agentId: string, _sessionId: string, sinceSeq: number, limit: number) =>
      events.filter((event) => event.seq > sinceSeq).slice(0, limit),
  );
  return { getSessionLastSeq, readSessionEventsAfter };
}

function event(type: string, seq: number): FakeEvent {
  return { type, seq, time: 1, data: {} };
}

describe("detectOpenTurn", () => {
  it("returns false for an empty log without reading events", () => {
    const source = createSource([]);
    expect(detectOpenTurn(source, "a1", "s1")).toBe(false);
    expect(source.readSessionEventsAfter).not.toHaveBeenCalled();
  });

  it("returns true for a trailing turn/start and false for a trailing turn/end", () => {
    expect(detectOpenTurn(createSource([event("turn/start", 0)]), "a1", "s1")).toBe(true);
    expect(
      detectOpenTurn(createSource([event("turn/start", 0), event("turn/end", 1)]), "a1", "s1"),
    ).toBe(false);
  });

  it("scans backwards across lookup pages", () => {
    const events: FakeEvent[] = [event("turn/start", 0)];
    for (let seq = 1; seq < 250; seq++) events.push(event("user/message", seq));

    expect(detectOpenTurn(createSource(events), "a1", "s1")).toBe(true);
  });
});

describe("replayHandshake", () => {
  it("sends session_ready, snapshot and run_status without a since cursor", () => {
    const source = createSource([event("turn/start", 0)]);
    const snapshot = [{ type: "agent_start" }];
    const sent: unknown[] = [];

    replayHandshake({
      source,
      agentId: "a1",
      sessionId: "s1",
      since: undefined,
      snapshot,
      runActive: true,
      notify: (event) => sent.push(event),
    });

    expect(sent).toEqual([
      { type: "session_ready", lastSeq: 0, replay: true },
      { type: "agent_start" },
      { type: "run_status", active: true },
    ]);
    expect(source.readSessionEventsAfter).not.toHaveBeenCalled();
  });

  it("replays persisted events after the since cursor before the snapshot", () => {
    const source = createSource([event("turn/start", 8), event("turn/start", 9)]);
    const sent: unknown[] = [];

    replayHandshake({
      source,
      agentId: "a1",
      sessionId: "s1",
      since: 7,
      snapshot: [{ type: "message_update" }],
      runActive: true,
      notify: (event) => sent.push(event),
    });

    expect(source.readSessionEventsAfter).toHaveBeenCalledWith(
      "a1",
      "s1",
      7,
      expect.any(Number),
    );
    expect(sent).toEqual([
      { type: "session_ready", lastSeq: 9, replay: true },
      { type: "replay_events", events: [event("turn/start", 8), event("turn/start", 9)] },
      { type: "replay_done" },
      { type: "message_update" },
      { type: "run_status", active: true },
    ]);
  });

  it("batches replay events in chunks of 200", () => {
    const events: FakeEvent[] = [];
    for (let seq = 0; seq < 250; seq++) events.push(event("user/message", seq));
    const sent: Array<{ type: string; events?: unknown[] }> = [];

    replayHandshake({
      source: createSource(events),
      agentId: "a1",
      sessionId: "s1",
      since: -1,
      snapshot: [],
      runActive: false,
      notify: (event) => sent.push(event as { type: string; events?: unknown[] }),
    });

    const batches = sent.filter((item) => item.type === "replay_events");
    expect(batches.map((batch) => batch.events?.length)).toEqual([200, 50]);
    expect(sent.at(-1)).toEqual({ type: "run_status", active: false });
  });
});
