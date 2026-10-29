import { describe, expect, it } from "vitest";
import { compactionSummaryFromEvents } from "../../session/compaction-snapshot.js";
import type { SessionEvent } from "../../session/events.js";

function event(partial: Partial<SessionEvent> & { seq: number }): SessionEvent {
  return {
    type: "compaction/applied",
    seq: partial.seq,
    time: partial.time ?? 1000,
    data: partial.data as SessionEvent["data"],
    ...partial,
  } as SessionEvent;
}

describe("compactionSummaryFromEvents", () => {
  it("returns null compaction and zero count without compaction events", () => {
    const events = [
      { type: "user/message", seq: 0, time: 1, data: { message: { role: "user" } } },
      { type: "turn/start", seq: 1, time: 2, data: {} },
    ] as unknown as SessionEvent[];
    expect(compactionSummaryFromEvents(events)).toEqual({ compaction: null, compactionCount: 0 });
    expect(compactionSummaryFromEvents([])).toEqual({ compaction: null, compactionCount: 0 });
  });

  it("derives meta from the latest compaction event only", () => {
    const events = [
      event({
        seq: 4,
        time: 10,
        data: { anchorSeq: 3, digestContent: "abc", excludedSeqs: [1, 2], digestSource: "llm" },
      }),
      event({
        seq: 9,
        time: 20,
        data: { anchorSeq: 7, digestContent: "abcdefgh", excludedSeqs: [], digestSource: "mechanical" },
      }),
    ];
    expect(compactionSummaryFromEvents(events)).toEqual({
      compaction: {
        seq: 9,
        anchorSeq: 7,
        digestSource: "mechanical",
        excludedCount: 0,
        digestLength: 8,
        appliedAtMs: 20,
      },
      compactionCount: 2,
    });
  });

  it("maps missing digestSource (legacy events) to null", () => {
    const events = [
      event({ seq: 2, time: 5, data: { anchorSeq: 1, digestContent: "x".repeat(10), excludedSeqs: [0] } }),
    ];
    expect(compactionSummaryFromEvents(events)).toEqual({
      compaction: {
        seq: 2,
        anchorSeq: 1,
        digestSource: null,
        excludedCount: 1,
        digestLength: 10,
        appliedAtMs: 5,
      },
      compactionCount: 1,
    });
  });

  it("degrades malformed payload fields to safe defaults", () => {
    const events = [
      event({
        seq: 3,
        time: 7,
        data: { anchorSeq: "no", digestContent: 42, excludedSeqs: null, digestSource: "other" },
      }),
    ];
    expect(compactionSummaryFromEvents(events)).toEqual({
      compaction: {
        seq: 3,
        anchorSeq: 0,
        digestSource: null,
        excludedCount: 0,
        digestLength: 0,
        appliedAtMs: 7,
      },
      compactionCount: 1,
    });
  });
});
