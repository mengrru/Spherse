import { describe, expect, it } from "vitest";
import {
  chatScope,
  parseChatScope,
  parseRpcClientFrame,
  parseRpcServerFrame,
} from "../rpc.js";

describe("rpc client frame contract", () => {
  it("accepts a call frame", () => {
    const frame = parseRpcClientFrame({
      type: "call",
      id: 1,
      method: "sessions.listProject",
      params: { projectId: "p1" },
    });
    expect(frame).toMatchObject({ type: "call", id: 1, method: "sessions.listProject" });
  });

  it("accepts a call frame without params", () => {
    expect(parseRpcClientFrame({ type: "call", id: 2, method: "agents.list" })).toMatchObject({
      type: "call",
      id: 2,
    });
  });

  it("rejects a call frame with malformed method name", () => {
    expect(() => parseRpcClientFrame({ type: "call", id: 1, method: "not a method" })).toThrow();
    expect(() => parseRpcClientFrame({ type: "call", id: 1, method: "Sessions.List" })).toThrow();
  });

  it("rejects a call frame with non-integer id", () => {
    expect(() => parseRpcClientFrame({ type: "call", id: "1", method: "sessions.get" })).toThrow();
  });

  it("accepts sub and unsub frames with and without since", () => {
    expect(
      parseRpcClientFrame({ type: "sub", id: 3, scope: "chat:p:a:s", since: 12 }),
    ).toMatchObject({ type: "sub", since: 12 });
    expect(parseRpcClientFrame({ type: "unsub", id: 4, scope: "chat:p:a:s" })).toMatchObject({
      type: "unsub",
    });
    expect(() => parseRpcClientFrame({ type: "sub", id: 5, scope: "" })).toThrow();
  });

  it("accepts a ping frame and rejects a pong from the client side", () => {
    expect(parseRpcClientFrame({ type: "ping" })).toEqual({ type: "ping" });
    expect(() => parseRpcClientFrame({ type: "pong" })).toThrow();
  });
});

describe("rpc server frame contract", () => {
  it("accepts a result frame with data or error", () => {
    expect(
      parseRpcServerFrame({ type: "result", id: 1, ok: true, data: { sessions: [] } }),
    ).toMatchObject({ type: "result", ok: true });
    expect(
      parseRpcServerFrame({
        type: "result",
        id: 2,
        ok: false,
        error: { code: 100, message: "Session not found" },
      }),
    ).toMatchObject({ ok: false });
  });

  it("rejects a result frame that carries neither data nor error shape", () => {
    expect(() => parseRpcServerFrame({ type: "result", id: 1, ok: "yes" })).toThrow();
  });

  it("accepts event frames with optional seq", () => {
    expect(
      parseRpcServerFrame({
        type: "event",
        scope: "chat:p:a:s",
        event: "assistant_delta",
        payload: { text: "hi" },
        seq: 5,
        ts: 1000,
      }),
    ).toMatchObject({ event: "assistant_delta" });
    expect(
      parseRpcServerFrame({
        type: "event",
        scope: "trigger:p",
        event: "trigger_triggered",
        payload: {},
        ts: 1000,
      }),
    ).toMatchObject({ event: "trigger_triggered" });
    expect(() =>
      parseRpcServerFrame({ type: "event", scope: "x", event: "e", payload: {}, ts: -1 }),
    ).toThrow();
  });

  it("accepts a snapshot frame carrying events", () => {
    expect(
      parseRpcServerFrame({
        type: "snapshot",
        id: 7,
        events: [
          {
            type: "event",
            scope: "chat:p:a:s",
            event: "turn/start",
            payload: {},
            seq: 1,
            ts: 1,
          },
        ],
      }),
    ).toMatchObject({ type: "snapshot", id: 7 });
  });

  it("accepts a pong frame and rejects a ping from the server side", () => {
    expect(parseRpcServerFrame({ type: "pong" })).toEqual({ type: "pong" });
    expect(() => parseRpcServerFrame({ type: "ping" })).toThrow();
  });
});

describe("chat scope helpers", () => {
  it("roundtrips a chat scope", () => {
    const scope = chatScope("proj-1", "agent-2", "sess-3");
    expect(parseChatScope(scope)).toEqual({
      projectId: "proj-1",
      agentId: "agent-2",
      sessionId: "sess-3",
    });
  });

  it("rejects non-chat and malformed scopes", () => {
    expect(parseChatScope("trigger:proj")).toBeNull();
    expect(parseChatScope("chat:only-two")).toBeNull();
    expect(parseChatScope("chat::agent:sess")).toBeNull();
  });
});
