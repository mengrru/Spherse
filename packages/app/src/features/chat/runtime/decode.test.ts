import { describe, expect, it, vi } from "vitest";
import { decodeServerFrame } from "./decode";

describe("decodeServerFrame", () => {
  it("decodes valid frames through the contracts parser", () => {
    expect(decodeServerFrame({ type: "run_status", active: true })).toEqual({
      kind: "event",
      event: { type: "run_status", active: true },
    });
  });

  it("preserves identity fields on message events", () => {
    expect(decodeServerFrame({
      type: "message_end",
      message: { role: "assistant", content: [] },
      messageId: "m1",
      seq: 3,
    })).toEqual({
      kind: "event",
      event: {
        type: "message_end",
        message: { role: "assistant", content: [] },
        messageId: "m1",
        seq: 3,
      },
    });
  });

  it("classifies protocol v2 handshake frames", () => {
    expect(decodeServerFrame({ type: "session_ready", lastSeq: 7, replay: true })).toEqual({
      kind: "session-ready",
      lastSeq: 7,
      replay: true,
    });
    expect(decodeServerFrame({
      type: "replay_events",
      events: [
        { type: "turn/start", seq: 1, time: 0, data: {} },
      ],
    })).toEqual({
      kind: "replay-events",
      events: [{ type: "turn/start", seq: 1, time: 0, data: {} }],
    });
    expect(decodeServerFrame({ type: "replay_done" })).toEqual({ kind: "replay-done" });
  });

  it("maps user_message and turn_retried into live events", () => {
    expect(decodeServerFrame({
      type: "user_message",
      seq: 4,
      message: { role: "user", content: "hi" },
      clientId: "c1",
      source: "triggered",
      triggerName: "cron",
    })).toEqual({
      kind: "event",
      event: {
        type: "user_message",
        seq: 4,
        message: { role: "user", content: "hi" },
        clientId: "c1",
        source: "triggered",
        triggerName: "cron",
      },
    });
    expect(decodeServerFrame({ type: "turn_retried", seq: 5, abandonedSeqs: [3] })).toEqual({
      kind: "event",
      event: { type: "turn_retried", seq: 5, abandonedSeqs: [3] },
    });
  });

  it("skips unknown replay events instead of dropping the whole batch", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const frame = decodeServerFrame({
      type: "replay_events",
      events: [
        { type: "turn/start", seq: 1, time: 0, data: {} },
        { type: "control/requested", seq: 2, time: 1, data: { requestId: "r1" } },
        { type: "turn/end", seq: 3, time: 2, data: { reason: "completed" } },
      ],
    });

    expect(frame).toEqual({
      kind: "replay-events",
      events: [
        { type: "turn/start", seq: 1, time: 0, data: {} },
        { type: "turn/end", seq: 3, time: 2, data: { reason: "completed" } },
      ],
    });
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("returns ignored and warns on invalid frames", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(decodeServerFrame({ type: "bogus" })).toEqual({ kind: "ignored" });
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
