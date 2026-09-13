import { describe, expect, it, vi } from "vitest";
import { decodeServerFrame } from "./decode";

describe("decodeServerFrame", () => {
  it("decodes valid frames through the contracts parser", () => {
    expect(decodeServerFrame({ type: "run_status", active: true })).toEqual({
      type: "run_status",
      active: true,
    });
  });

  it("preserves identity fields on message events", () => {
    expect(decodeServerFrame({
      type: "message_end",
      message: { role: "assistant", content: [] },
      messageId: "m1",
      seq: 3,
    })).toMatchObject({ type: "message_end", messageId: "m1", seq: 3 });
  });

  it("returns undefined for v2 replay events until they are consumed", () => {
    expect(decodeServerFrame({ type: "replay_done" })).toBeUndefined();
    expect(decodeServerFrame({ type: "session_ready", lastSeq: 0, replay: false })).toBeUndefined();
  });

  it("returns undefined and warns on invalid frames", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(decodeServerFrame({ type: "bogus" })).toBeUndefined();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
