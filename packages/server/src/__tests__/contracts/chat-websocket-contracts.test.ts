import { describe, expect, it } from "vitest";
import {
  parseChatClientMessage,
  parseChatServerEvent,
} from "../../contracts/index.js";

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
});
