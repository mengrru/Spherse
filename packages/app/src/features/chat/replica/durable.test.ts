import { describe, expect, it } from "vitest";
import type { AgentMessage } from "@spherse/core";
import {
  applySettledFrame,
  applySnapshot,
  enterSnapshotMode,
  initialDurable,
} from "./durable";

function userMessage(content: string): AgentMessage {
  return { role: "user", content, timestamp: 1 };
}

function assistantMessage(text: string): AgentMessage {
  return { role: "assistant", content: [{ type: "text", text }], timestamp: 2 } as AgentMessage;
}

describe("durable zone", () => {
  it("inserts settled entries in seq order and advances the watermark", () => {
    let durable = initialDurable();
    durable = applySettledFrame(durable, { type: "message_settled", seq: 0, message: userMessage("q") }).durable;
    durable = applySettledFrame(durable, { type: "message_settled", seq: 1, message: assistantMessage("a") }).durable;
    durable = applySettledFrame(durable, { type: "message_settled", seq: 2, message: assistantMessage("b") }).durable;

    expect(durable.entries.map((entry) => entry.seq)).toEqual([0, 1, 2]);
    expect(durable.highSeq).toBe(2);
    expect(durable.mode).toBe("events");
  });

  it("treats duplicate seq as an idempotent no-op (message_end{seq} ≡ message_settled{seq})", () => {
    let durable = initialDurable();
    durable = applySettledFrame(durable, { type: "message_settled", seq: 5, message: assistantMessage("x") }).durable;
    const before = durable;
    durable = applySettledFrame(durable, { type: "message_settled", seq: 5, message: assistantMessage("x") }).durable;
    expect(durable).toBe(before);
  });

  it("flags a watermark violation carrying the missing seq when a forward frame arrives below the watermark", () => {
    let durable = initialDurable();
    durable = applySettledFrame(durable, { type: "message_settled", seq: 10, message: userMessage("q") }).durable;
    const outcome = applySettledFrame(durable, { type: "message_settled", seq: 7, message: assistantMessage("gap") });
    expect(outcome.violation).toBe(true);
    expect(outcome.durable.resyncNeeded).toBe(7);
    expect(outcome.durable.entries.map((entry) => entry.seq)).toEqual([7, 10]);
  });

  it("applies tier-2 frames below the watermark leniently without flagging (tier-2 vs live interleaving is expected)", () => {
    let durable = initialDurable();
    durable = applySettledFrame(durable, { type: "message_settled", seq: 50, message: userMessage("live-first") }).durable;
    durable = applySettledFrame(durable, { type: "message_settled", seq: 49, message: assistantMessage("tier2-late") }, { lenientReorder: true }).durable;
    durable = applySettledFrame(durable, { type: "message_settled", seq: 48, message: assistantMessage("tier2-late") }, { lenientReorder: true }).durable;
    expect(durable.resyncNeeded).toBe(null);
    expect(durable.entries.map((entry) => entry.seq)).toEqual([48, 49, 50]);
  });

  it("clears the violation flag when the withdrawal range covers the missing seq", () => {
    let durable = initialDurable();
    durable = applySettledFrame(durable, { type: "message_settled", seq: 10, message: userMessage("q") }).durable;
    durable = applySettledFrame(durable, { type: "message_settled", seq: 8, message: assistantMessage("gap") }).durable;
    expect(durable.resyncNeeded).toBe(8);
    durable = applySettledFrame(durable, { type: "turn_withdrawn", seq: 7, upTo: 11 }).durable;
    expect(durable.resyncNeeded).toBe(null);
  });

  it("deletes the [seq, upTo) range for turn_withdrawn and advances the watermark to upTo", () => {
    let durable = initialDurable();
    for (const [seq, message] of [
      [0, userMessage("q")],
      [1, assistantMessage("a")],
      [2, { role: "toolResult" as const, toolCallId: "t1", toolName: "write_file", content: [], timestamp: 3 }],
      [3, assistantMessage("b")],
    ] as const) {
      durable = applySettledFrame(durable, { type: "message_settled", seq, message: message as never }).durable;
    }
    durable = applySettledFrame(durable, { type: "turn_withdrawn", seq: 0, upTo: 4 }).durable;

    expect(durable.entries).toEqual([]);
    expect(durable.highSeq).toBe(4);
  });

  it("deletes only the abandoned seqs for turn_retried", () => {
    let durable = initialDurable();
    durable = applySettledFrame(durable, { type: "message_settled", seq: 0, message: userMessage("q") }).durable;
    durable = applySettledFrame(durable, { type: "message_settled", seq: 1, message: assistantMessage("bad") }).durable;
    durable = applySettledFrame(durable, { type: "message_settled", seq: 2, message: assistantMessage("good") }).durable;
    durable = applySettledFrame(durable, { type: "turn_retried", seq: 3, abandonedSeqs: [1] }).durable;

    expect(durable.entries.map((entry) => entry.seq)).toEqual([0, 2]);
    expect(durable.highSeq).toBe(3);
  });

  it("replaces the [oldestSeq, ∞) range on a partial snapshot while keeping the older prefix", () => {
    let durable = initialDurable();
    durable = applySnapshot(durable, {
      entries: [
        { id: 0, message: userMessage("old") },
        { id: 1, message: assistantMessage("older-a") },
        { id: 8, message: userMessage("newer") },
        { id: 9, message: assistantMessage("newer-a") },
      ],
      hasMore: true,
      oldestId: 0,
      full: false,
    });

    durable = applySnapshot(durable, {
      entries: [
        { id: 2, message: userMessage("refreshed") },
        { id: 3, message: assistantMessage("refreshed-a") },
      ],
      hasMore: false,
      oldestId: 2,
      full: false,
    });

    expect(durable.entries.map((entry) => entry.seq)).toEqual([0, 1, 2, 3]);
    expect(durable.highSeq).toBe(9);
    expect(durable.hasMore).toBe(false);
    expect(durable.oldestLoadedId).toBe(2);
  });

  it("resets entries and watermark on a full snapshot", () => {
    let durable = initialDurable();
    durable = applySettledFrame(durable, { type: "message_settled", seq: 57, message: userMessage("legacy-id") }).durable;
    durable = applySnapshot(durable, {
      entries: [
        { id: 0, message: userMessage("migrated") },
        { id: 1, message: assistantMessage("fresh") },
      ],
      hasMore: false,
      oldestId: 0,
      full: true,
    });

    expect(durable.entries.map((entry) => entry.seq)).toEqual([0, 1]);
    expect(durable.highSeq).toBe(1);
    expect(durable.resyncNeeded).toBe(null);
  });

  it("flags a resync when a deletion frame is the first eventized data in snapshot mode", () => {
    let durable = initialDurable();
    durable = applySnapshot(durable, {
      entries: [{ id: 5, message: userMessage("legacy row") }],
      hasMore: false,
      oldestId: 5,
      full: false,
    });
    durable = enterSnapshotMode(durable);

    const outcome = applySettledFrame(durable, { type: "turn_withdrawn", seq: 0, upTo: 2 });
    expect(outcome.durable.mode).toBe("events");
    expect(outcome.durable.entries).toEqual([]);
    expect(outcome.durable.resyncNeeded).toBe(0);
  });

  it("drops all snapshot entries when the first eventized frame arrives in snapshot mode", () => {
    let durable = initialDurable();
    durable = applySnapshot(durable, {
      entries: [
        { id: 5, message: userMessage("legacy row") },
        { id: 6, message: assistantMessage("legacy reply") },
      ],
      hasMore: false,
      oldestId: 5,
      full: false,
    });
    durable = enterSnapshotMode(durable);
    expect(durable.highSeq).toBeNull();

    durable = applySettledFrame(durable, { type: "message_settled", seq: 0, message: userMessage("post-migration") }).durable;
    expect(durable.mode).toBe("events");
    expect(durable.entries.map((entry) => entry.seq)).toEqual([0]);
    expect(durable.highSeq).toBe(0);
  });

  it("keeps seq-keyed snapshot ids folded by live frames in unknown mode without collision", () => {
    let durable = initialDurable();
    durable = applySnapshot(durable, {
      entries: [{ id: 3, message: userMessage("snapshot") }],
      hasMore: false,
      oldestId: 3,
      full: false,
    });
    durable = applySettledFrame(durable, { type: "message_settled", seq: 4, message: assistantMessage("live") }).durable;
    expect(durable.entries.map((entry) => entry.seq)).toEqual([3, 4]);
    expect(durable.mode).toBe("events");
  });
});
