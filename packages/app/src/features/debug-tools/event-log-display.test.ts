import { describe, expect, it } from "vitest";
import type { DebugSessionEventContract } from "@spherse/contracts";
import { compactionStatusFromEvents, eventBadgeVariant, eventPreview } from "./event-log-display";

const compactionPayload = {
  anchorSeq: 8,
  digestContent: "<compaction-digest>summary of earlier turns</compaction-digest>",
  excludedSeqs: [9, 10, 11],
  digestSource: "llm",
};

const compactionEvent: DebugSessionEventContract = {
  seq: 12,
  type: "compaction/applied",
  time: 1700000000000,
  data: compactionPayload,
};

describe("event-log-display", () => {
  it("renders a secondary badge for compaction/applied", () => {
    expect(eventBadgeVariant("compaction/applied")).toBe("secondary");
  });

  it("previews compaction/applied with anchorSeq and digest snippet", () => {
    expect(eventPreview(compactionEvent)).toBe(
      "anchorSeq: 8 · <compaction-digest>summary of earlier turns</compaction-digest>",
    );
  });

  it("truncates long digest content in the preview", () => {
    const long: DebugSessionEventContract = {
      ...compactionEvent,
      data: { ...compactionPayload, digestContent: "x".repeat(200) },
    };
    const preview = eventPreview(long);
    expect(preview).toContain("anchorSeq: 8 · ");
    expect(preview.length).toBeLessThan(120);
    expect(preview.endsWith("…")).toBe(true);
  });

  it("derives null compaction status without compaction events", () => {
    expect(compactionStatusFromEvents([])).toEqual({ compaction: null, compactionCount: 0 });
    const nonCompaction: DebugSessionEventContract = { ...compactionEvent, type: "turn/start", data: {} };
    expect(compactionStatusFromEvents([nonCompaction])).toEqual({ compaction: null, compactionCount: 0 });
  });

  it("derives compaction status from the latest event", () => {
    const first: DebugSessionEventContract = {
      seq: 4,
      type: "compaction/applied",
      time: 1700000000000,
      data: { anchorSeq: 2, digestContent: "abc", excludedSeqs: [3], digestSource: "mechanical" },
    };
    const status = compactionStatusFromEvents([first, compactionEvent]);
    expect(status).toEqual({
      compaction: {
        seq: 12,
        anchorSeq: 8,
        digestSource: "llm",
        excludedCount: 3,
        digestLength: 63,
        appliedAtMs: 1700000000000,
      },
      compactionCount: 2,
    });
  });

  it("degrades malformed compaction payload fields to safe defaults", () => {
    const malformed: DebugSessionEventContract = {
      seq: 5,
      type: "compaction/applied",
      time: 7,
      data: { anchorSeq: "no", digestContent: 42, excludedSeqs: null, digestSource: "other" },
    };
    expect(compactionStatusFromEvents([malformed])).toEqual({
      compaction: {
        seq: 5,
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
