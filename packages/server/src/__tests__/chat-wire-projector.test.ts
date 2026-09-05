import { describe, expect, it } from "vitest";
import { ChatWireProjector } from "../chat/chat-wire-projector.js";
import type { SessionEvent } from "@spherse/core";

function logEvent<T extends SessionEvent["type"]>(
  type: T,
  seq: number,
  data: Extract<SessionEvent, { type: T }>["data"],
): SessionEvent {
  return { type, seq, time: 1, data } as SessionEvent;
}

describe("ChatWireProjector", () => {
  it("sequences messageIds across a run", () => {
    const projector = new ChatWireProjector();
    projector.resetRun();

    expect(projector.enrich({ type: "message_start", message: {} })).toMatchObject({
      type: "message_start",
      messageId: "m1",
    });
    expect(projector.enrich({ type: "message_update", message: {} })).toMatchObject({
      messageId: "m1",
    });
    expect(projector.enrich({ type: "message_end", message: {} })).toMatchObject({
      type: "message_end",
      messageId: "m1",
    });
    expect(projector.enrich({ type: "message_update", message: {} })).not.toHaveProperty(
      "messageId",
    );
    expect(projector.enrich({ type: "message_start", message: {} })).toMatchObject({
      messageId: "m2",
    });
  });

  it("restarts messageId sequencing after resetRun", () => {
    const projector = new ChatWireProjector();
    projector.resetRun();
    projector.enrich({ type: "message_start", message: {} });
    projector.enrich({ type: "message_end", message: {} });

    projector.resetRun();

    expect(projector.enrich({ type: "message_start", message: {} })).toMatchObject({
      messageId: "m1",
    });
  });

  it("pairs message_end with the seq recorded from the log by reference", () => {
    const projector = new ChatWireProjector();
    projector.resetRun();
    const assistant = { role: "assistant", content: [] };
    const other = { role: "toolResult", content: [] };

    expect(
      projector.consumeLogEvent(logEvent("assistant/message", 7, { message: assistant as never })),
    ).toBeUndefined();
    expect(projector.consumeLogEvent(logEvent("tool/result", 8, { message: other as never }))).toBeUndefined();

    expect(projector.enrich({ type: "message_end", message: assistant })).toMatchObject({
      seq: 7,
    });
    expect(projector.enrich({ type: "message_end", message: other })).toMatchObject({
      seq: 8,
    });
    expect(projector.enrich({ type: "message_end", message: { role: "user" } })).not.toHaveProperty(
      "seq",
    );
  });

  it("drops reference pairings from the previous run after resetRun", () => {
    const projector = new ChatWireProjector();
    projector.resetRun();
    const assistant = { role: "assistant", content: [] };
    projector.consumeLogEvent(logEvent("assistant/message", 3, { message: assistant as never }));

    projector.resetRun();

    expect(projector.enrich({ type: "message_end", message: assistant })).not.toHaveProperty(
      "seq",
    );
  });

  it("echoes user/message with the pending clientId once, then clears it", () => {
    const projector = new ChatWireProjector();
    const message = { role: "user", content: "hi" };

    projector.markPendingEcho("c1");
    expect(
      projector.consumeLogEvent(logEvent("user/message", 0, { message: message as never })),
    ).toEqual({
      type: "user_message",
      seq: 0,
      message,
      clientId: "c1",
    });
    expect(
      projector.consumeLogEvent(logEvent("user/message", 2, { message: message as never })),
    ).toEqual({
      type: "user_message",
      seq: 2,
      message,
    });
  });

  it("passes trigger metadata through the echo", () => {
    const projector = new ChatWireProjector();
    const message = { role: "user", content: "go" };

    expect(
      projector.consumeLogEvent(
        logEvent("user/message", 5, {
          message: message as never,
          source: "triggered",
          triggerName: "t1",
        }),
      ),
    ).toEqual({
      type: "user_message",
      seq: 5,
      message,
      source: "triggered",
      triggerName: "t1",
    });
  });

  it("discards a pending echo only for its own clientId", () => {
    const projector = new ChatWireProjector();
    projector.markPendingEcho("a");

    projector.discardPendingEcho("b");
    expect(
      projector.consumeLogEvent(logEvent("user/message", 0, { message: {} as never })),
    ).toMatchObject({ clientId: "a" });

    projector.markPendingEcho("a");
    projector.discardPendingEcho("a");
    expect(
      projector.consumeLogEvent(logEvent("user/message", 1, { message: {} as never })),
    ).not.toHaveProperty("clientId");
  });

  it("clearPendingEcho removes any pending clientId", () => {
    const projector = new ChatWireProjector();
    projector.markPendingEcho("a");
    projector.clearPendingEcho();
    expect(
      projector.consumeLogEvent(logEvent("user/message", 0, { message: {} as never })),
    ).not.toHaveProperty("clientId");
  });

  it("translates turn/retried and ignores non-message log events", () => {
    const projector = new ChatWireProjector();

    expect(
      projector.consumeLogEvent(logEvent("turn/retried", 9, { abandonedSeqs: [5, 6] })),
    ).toEqual({
      type: "turn_retried",
      seq: 9,
      abandonedSeqs: [5, 6],
    });
    expect(projector.consumeLogEvent(logEvent("turn/start", 0, {}))).toEqual({
      type: "run_status",
      active: true,
    });
    expect(projector.consumeLogEvent(logEvent("turn/start", 1, {}))).toBeUndefined();
    expect(projector.consumeLogEvent(logEvent("turn/end", 2, { reason: "completed" }))).toEqual({
      type: "run_status",
      active: false,
    });
    expect(projector.consumeLogEvent(logEvent("turn/end", 3, { reason: "completed" }))).toBeUndefined();
    expect(projector.isRunActive()).toBe(false);
    expect(
      projector.consumeLogEvent(
        logEvent("compaction/applied", 4, {
          anchorSeq: 1,
          digestContent: "d",
          excludedSeqs: [],
        }),
      ),
    ).toBeUndefined();
    expect(projector.consumeLogEvent(logEvent("turn/withdrawn", 6, { seq: 2 }))).toBeUndefined();
  });

  it("enriches agent_end with the last turn/end seq", () => {
    const projector = new ChatWireProjector();
    expect(projector.enrich({ type: "agent_end", messages: [] })).not.toHaveProperty("seq");

    projector.consumeLogEvent(logEvent("turn/end", 12, { reason: "completed" }));
    expect(projector.enrich({ type: "agent_end", messages: [] })).toMatchObject({ seq: 12 });
  });

  it("passes unrelated wire events through unchanged", () => {
    const projector = new ChatWireProjector();
    const event = { type: "tool_execution_start", toolCallId: "tc1" };
    expect(projector.enrich(event)).toBe(event);
  });
});
