import { describe, expect, it } from "vitest";
import {
  parseChatClientMessage,
  parseChatServerEvent,
  parseContract,
  schemas,
} from "../index.js";

describe("chat websocket control contract", () => {
  it("accepts question control_request server event", () => {
    const event = {
      type: "control_request",
      requestId: "req1",
      kind: "question",
      toolCallId: "call1",
      toolName: "ask_user",
      args: { question: "Which option?" },
    };
    expect(parseChatServerEvent(event)).toEqual(event);
  });

  it("accepts question control_resolved server event with answer", () => {
    const event = {
      type: "control_resolved",
      requestId: "req1",
      kind: "question",
      answer: "the first one",
      timedOut: false,
    };
    expect(parseChatServerEvent(event)).toEqual(event);
  });

  it("accepts question control_resolved server event without answer", () => {
    const event = {
      type: "control_resolved",
      requestId: "req2",
      kind: "question",
      timedOut: true,
    };
    expect(parseChatServerEvent(event)).toEqual(event);
  });

  it("keeps approval control server events parsing", () => {
    const request = {
      type: "control_request",
      requestId: "req3",
      kind: "approval",
      toolCallId: "call2",
      toolName: "run_command",
      args: { command: "ls" },
    };
    expect(parseChatServerEvent(request)).toEqual(request);
    const resolved = {
      type: "control_resolved",
      requestId: "req3",
      kind: "approval",
      approved: false,
      reason: "not allowed",
    };
    expect(parseChatServerEvent(resolved)).toEqual(resolved);
  });

  it("rejects malformed control server events", () => {
    expect(() =>
      parseChatServerEvent({ type: "control_request", kind: "question" }),
    ).toThrow(/Invalid payload/);
    expect(() =>
      parseChatServerEvent({
        type: "control_request",
        requestId: "req1",
        kind: "question",
        toolCallId: "call1",
      }),
    ).toThrow(/Invalid payload/);
    expect(() =>
      parseChatServerEvent({
        type: "control_resolved",
        requestId: "req1",
        kind: "question",
        answer: "yes",
      }),
    ).toThrow(/Invalid payload/);
    expect(() =>
      parseChatServerEvent({
        type: "control_request",
        requestId: "req1",
        kind: "unknown",
        toolCallId: "call1",
        toolName: "ask_user",
        args: {},
      }),
    ).toThrow(/Invalid payload/);
  });

  it("accepts resolve_control_request with approval payload", () => {
    expect(
      parseChatClientMessage({
        type: "resolve_control_request",
        requestId: "req1",
        kind: "approval",
        approved: true,
      }),
    ).toEqual({
      type: "resolve_control_request",
      requestId: "req1",
      kind: "approval",
      approved: true,
    });
    expect(
      parseChatClientMessage({
        type: "resolve_control_request",
        requestId: "req1",
        kind: "approval",
        approved: false,
        reason: "nope",
      }),
    ).toEqual({
      type: "resolve_control_request",
      requestId: "req1",
      kind: "approval",
      approved: false,
      reason: "nope",
    });
  });

  it("accepts resolve_control_request with question payload", () => {
    expect(
      parseChatClientMessage({
        type: "resolve_control_request",
        requestId: "req2",
        kind: "question",
        answer: "go with option B",
      }),
    ).toEqual({
      type: "resolve_control_request",
      requestId: "req2",
      kind: "question",
      answer: "go with option B",
    });
  });

  it("rejects question resolve_control_request without answer", () => {
    expect(() =>
      parseChatClientMessage({
        type: "resolve_control_request",
        requestId: "req2",
        kind: "question",
      }),
    ).toThrow(/Invalid payload/);
    expect(() =>
      parseChatClientMessage({
        type: "resolve_control_request",
        requestId: "req2",
        kind: "question",
        answer: 42,
      }),
    ).toThrow(/Invalid payload/);
    expect(() =>
      parseChatClientMessage({
        type: "resolve_control_request",
        requestId: "req2",
        kind: "question",
        answer: "",
      }),
    ).toThrow(/Invalid payload/);
  });

  it("rejects approval resolve_control_request without approved", () => {
    expect(() =>
      parseChatClientMessage({
        type: "resolve_control_request",
        requestId: "req1",
        kind: "approval",
      }),
    ).toThrow(/Invalid payload/);
    expect(() =>
      parseChatClientMessage({
        type: "resolve_control_request",
        requestId: "req1",
        kind: "approval",
        reason: "nope",
      }),
    ).toThrow(/Invalid payload/);
  });

  it("rejects resolve_control_request with unknown kind", () => {
    expect(() =>
      parseChatClientMessage({
        type: "resolve_control_request",
        requestId: "req1",
        kind: "unknown",
        answer: "x",
      }),
    ).toThrow(/Invalid payload/);
  });

  it("accepts withdraw client message", () => {
    expect(parseChatClientMessage({ type: "withdraw" })).toEqual({
      type: "withdraw",
    });
  });

  it("accepts turn_withdrawn server event", () => {
    const event = { type: "turn_withdrawn", seq: 3 };
    expect(parseChatServerEvent(event)).toEqual(event);
  });

  it("rejects turn_withdrawn without seq", () => {
    expect(() => parseChatServerEvent({ type: "turn_withdrawn" })).toThrow(
      /Invalid payload/,
    );
    expect(() =>
      parseChatServerEvent({ type: "turn_withdrawn", seq: "3" }),
    ).toThrow(/Invalid payload/);
  });

  it("accepts turn_withdrawn with optional upTo", () => {
    const event = { type: "turn_withdrawn", seq: 3, upTo: 6 };
    expect(parseChatServerEvent(event)).toEqual(event);
    expect(parseChatServerEvent({ type: "turn_withdrawn", seq: 3 })).toEqual({
      type: "turn_withdrawn",
      seq: 3,
    });
  });

  it("accepts message_settled with and without intentId", () => {
    const withIntent = {
      type: "message_settled",
      seq: 42,
      message: { role: "user", content: "hi" },
      intentId: "01JTEST",
    };
    expect(parseChatServerEvent(withIntent)).toEqual(withIntent);
    const withoutIntent = {
      type: "message_settled",
      seq: 43,
      message: { role: "assistant", content: [] },
    };
    expect(parseChatServerEvent(withoutIntent)).toEqual(withoutIntent);
  });

  it("rejects message_settled without seq or message", () => {
    expect(() =>
      parseChatServerEvent({ type: "message_settled", message: { role: "user", content: "hi" } }),
    ).toThrow(/Invalid payload/);
    expect(() => parseChatServerEvent({ type: "message_settled", seq: 42 })).toThrow(
      /Invalid payload/,
    );
    expect(() => parseChatServerEvent({ type: "message_settled", seq: "42", message: {} })).toThrow(
      /Invalid payload/,
    );
  });

  it("accepts message_end with optional seq", () => {
    const event = {
      type: "message_end",
      message: { role: "assistant", content: [] },
      seq: 42,
    };
    expect(parseChatServerEvent(event)).toEqual(event);
    expect(
      parseChatServerEvent({ type: "message_end", message: { role: "assistant", content: [] } }),
    ).toEqual({ type: "message_end", message: { role: "assistant", content: [] } });
    expect(() => parseChatServerEvent({ type: "message_end", message: {}, seq: "42" })).toThrow(
      /Invalid payload/,
    );
  });

  it("accepts turn_retried and rejects malformed variants", () => {
    const event = { type: "turn_retried", seq: 50, abandonedSeqs: [45, 46] };
    expect(parseChatServerEvent(event)).toEqual(event);
    expect(() => parseChatServerEvent({ type: "turn_retried", seq: 50 })).toThrow(
      /Invalid payload/,
    );
    expect(() =>
      parseChatServerEvent({ type: "turn_retried", seq: 50, abandonedSeqs: [true] }),
    ).toThrow(/Invalid payload/);
  });

  it("accepts client message with optional intentId and rejects malformed intentId", () => {
    expect(
      parseChatClientMessage({ type: "message", content: "hi", intentId: "01JWS" }),
    ).toEqual({ type: "message", content: "hi", intentId: "01JWS" });
    expect(parseChatClientMessage({ type: "message", content: "hi" })).toEqual({
      type: "message",
      content: "hi",
    });
    expect(() =>
      parseChatClientMessage({ type: "message", content: "hi", intentId: 42 }),
    ).toThrow(/Invalid payload/);
  });

  it("settledFrame schema accepts the three frame kinds and rejects others", () => {
    const { settledFrame } = schemas;
    expect(
      parseContract(settledFrame, { type: "message_settled", seq: 1, message: {} }),
    ).toEqual({ type: "message_settled", seq: 1, message: {} });
    expect(parseContract(settledFrame, { type: "turn_withdrawn", seq: 1, upTo: 3 })).toEqual({
      type: "turn_withdrawn",
      seq: 1,
      upTo: 3,
    });
    expect(parseContract(settledFrame, { type: "turn_retried", seq: 5, abandonedSeqs: [] })).toEqual(
      { type: "turn_retried", seq: 5, abandonedSeqs: [] },
    );
    expect(() => parseContract(settledFrame, { type: "message_end", seq: 1 })).toThrow(
      /Invalid payload/,
    );
  });
});
