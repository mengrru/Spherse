import { describe, expect, it } from "vitest";
import {
  parseBusClientMessage,
  parseBusServerMessage,
  parseTriggerServerEvent,
} from "../index.js";

describe("bus server message contract", () => {
  it("accepts trigger_triggered envelope", () => {
    expect(
      parseBusServerMessage({
        channel: "trigger",
        projectId: "p1",
        type: "trigger_triggered",
        payload: { agentId: "a1", triggerId: "t1", triggeredAt: 123 },
      }),
    ).toEqual({
      channel: "trigger",
      projectId: "p1",
      type: "trigger_triggered",
      payload: { agentId: "a1", triggerId: "t1", triggeredAt: 123 },
    });
  });

  it("accepts trigger_triggered envelope with optional sessionId and eventName", () => {
    expect(
      parseBusServerMessage({
        channel: "trigger",
        projectId: "p1",
        type: "trigger_triggered",
        payload: { agentId: "a1", triggerId: "t1", sessionId: "sess1", eventName: "evt", triggeredAt: 1 },
      }),
    ).toEqual({
      channel: "trigger",
      projectId: "p1",
      type: "trigger_triggered",
      payload: { agentId: "a1", triggerId: "t1", sessionId: "sess1", eventName: "evt", triggeredAt: 1 },
    });
  });

  it("accepts trigger_completed envelope", () => {
    expect(
      parseBusServerMessage({
        channel: "trigger",
        projectId: "p1",
        type: "trigger_completed",
        payload: { agentId: "a1", triggerId: "t1", sessionId: "sess1", status: "success" },
      }),
    ).toEqual({
      channel: "trigger",
      projectId: "p1",
      type: "trigger_completed",
      payload: { agentId: "a1", triggerId: "t1", sessionId: "sess1", status: "success" },
    });
  });

  it("accepts trigger_failed envelope", () => {
    expect(
      parseBusServerMessage({
        channel: "trigger",
        projectId: "p1",
        type: "trigger_failed",
        payload: { agentId: "a1", triggerId: "t1", error: "boom" },
      }),
    ).toEqual({
      channel: "trigger",
      projectId: "p1",
      type: "trigger_failed",
      payload: { agentId: "a1", triggerId: "t1", error: "boom" },
    });
  });

  it("accepts trigger_updated envelope with optional trigger", () => {
    expect(
      parseBusServerMessage({
        channel: "trigger",
        projectId: "p1",
        type: "trigger_updated",
        payload: { agentId: "a1", triggerId: "t1" },
      }),
    ).toEqual({
      channel: "trigger",
      projectId: "p1",
      type: "trigger_updated",
      payload: { agentId: "a1", triggerId: "t1" },
    });
  });

  it("accepts agent_updated envelope", () => {
    expect(
      parseBusServerMessage({
        channel: "agent",
        projectId: "p1",
        type: "agent_updated",
        payload: { agentId: "a1", action: "created" },
      }),
    ).toEqual({
      channel: "agent",
      projectId: "p1",
      type: "agent_updated",
      payload: { agentId: "a1", action: "created" },
    });
  });

  it("rejects an unknown agent_updated action", () => {
    expect(() =>
      parseBusServerMessage({
        channel: "agent",
        projectId: "p1",
        type: "agent_updated",
        payload: { agentId: "a1", action: "renamed" },
      }),
    ).toThrow();
  });

  it("accepts fs-watch change envelope", () => {
    expect(
      parseBusServerMessage({
        channel: "fs-watch",
        projectId: "p1",
        type: "change",
        payload: { eventType: "rename", path: "/a/b.md" },
      }),
    ).toEqual({
      channel: "fs-watch",
      projectId: "p1",
      type: "change",
      payload: { eventType: "rename", path: "/a/b.md" },
    });
  });

  it("accepts debug log envelope without projectId", () => {
    expect(
      parseBusServerMessage({
        channel: "debug",
        type: "log",
        payload: { line: "hello" },
      }),
    ).toEqual({
      channel: "debug",
      type: "log",
      payload: { line: "hello" },
    });
  });

  it("accepts __system__ pong envelope", () => {
    expect(
      parseBusServerMessage({
        channel: "__system__",
        type: "pong",
        payload: {},
      }),
    ).toEqual({
      channel: "__system__",
      type: "pong",
      payload: {},
    });
  });

  it("accepts __system__ fs_watch_error envelope with projectId", () => {
    expect(
      parseBusServerMessage({
        channel: "__system__",
        projectId: "p1",
        type: "fs_watch_error",
        payload: { error: "ENOENT" },
      }),
    ).toEqual({
      channel: "__system__",
      projectId: "p1",
      type: "fs_watch_error",
      payload: { error: "ENOENT" },
    });
  });

  it("rejects trigger envelope missing projectId", () => {
    expect(() =>
      parseBusServerMessage({
        channel: "trigger",
        type: "trigger_triggered",
        payload: { agentId: "a1", triggerId: "t1", triggeredAt: 1 },
      }),
    ).toThrow(/Invalid payload/);
  });

  it("rejects trigger envelope with malformed payload", () => {
    expect(() =>
      parseBusServerMessage({
        channel: "trigger",
        projectId: "p1",
        type: "trigger_triggered",
        payload: { triggerId: "t1", triggeredAt: 1 },
      }),
    ).toThrow(/Invalid payload/);
  });

  it("rejects trigger_completed with wrong status", () => {
    expect(() =>
      parseBusServerMessage({
        channel: "trigger",
        projectId: "p1",
        type: "trigger_completed",
        payload: { agentId: "a1", triggerId: "t1", sessionId: "x", status: "failed" },
      }),
    ).toThrow(/Invalid payload/);
  });

  it("rejects unknown channel", () => {
    expect(() =>
      parseBusServerMessage({
        channel: "bogus",
        projectId: "p1",
        type: "log",
        payload: { line: "x" },
      }),
    ).toThrow(/Invalid payload/);
  });

  it("rejects non-object payloads", () => {
    expect(() => parseBusServerMessage("nope")).toThrow(/Invalid payload/);
    expect(() => parseBusServerMessage(null)).toThrow(/Invalid payload/);
    expect(() => parseBusServerMessage(42)).toThrow(/Invalid payload/);
  });
});

describe("bus client message contract", () => {
  it("accepts subscribe messages across channels", () => {
    for (const channel of ["trigger", "fs-watch", "debug"] as const) {
      expect(parseBusClientMessage({ kind: "subscribe", projectId: "p1", channel })).toEqual({
        kind: "subscribe",
        projectId: "p1",
        channel,
      });
    }
  });

  it("accepts unsubscribe messages across channels", () => {
    for (const channel of ["trigger", "fs-watch", "debug"] as const) {
      expect(parseBusClientMessage({ kind: "unsubscribe", projectId: "p1", channel })).toEqual({
        kind: "unsubscribe",
        projectId: "p1",
        channel,
      });
    }
  });

  it("accepts ping message", () => {
    expect(parseBusClientMessage({ kind: "ping" })).toEqual({ kind: "ping" });
  });

  it("accepts emit-trigger-event message", () => {
    expect(
      parseBusClientMessage({
        kind: "emit-trigger-event",
        projectId: "p1",
        eventName: "user-login",
        payload: "hello",
      }),
    ).toEqual({
      kind: "emit-trigger-event",
      projectId: "p1",
      eventName: "user-login",
      payload: "hello",
    });
  });

  it("accepts emit-trigger-event without payload", () => {
    expect(
      parseBusClientMessage({
        kind: "emit-trigger-event",
        projectId: "p1",
        eventName: "user-login",
      }),
    ).toEqual({
      kind: "emit-trigger-event",
      projectId: "p1",
      eventName: "user-login",
    });
  });

  it("rejects emit-trigger-event with sp: prefix", () => {
    expect(() =>
      parseBusClientMessage({
        kind: "emit-trigger-event",
        projectId: "p1",
        eventName: "",
      }),
    ).toThrow(/Invalid payload/);
  });

  it("rejects subscribe with missing channel", () => {
    expect(() => parseBusClientMessage({ kind: "subscribe", projectId: "p1" })).toThrow(
      /Invalid payload/,
    );
  });

  it("rejects subscribe with __system__ channel", () => {
    expect(() =>
      parseBusClientMessage({ kind: "subscribe", projectId: "p1", channel: "__system__" }),
    ).toThrow(/Invalid payload/);
  });

  it("rejects unknown kind", () => {
    expect(() => parseBusClientMessage({ kind: "bogus" })).toThrow(/Invalid payload/);
  });
});

describe("trigger server event contract", () => {
  it("accepts trigger_triggered shape", () => {
    expect(
      parseTriggerServerEvent({
        type: "trigger_triggered",
        agentId: "a1",
        triggerId: "t1",
        triggeredAt: 5,
      }),
    ).toEqual({
      type: "trigger_triggered",
      agentId: "a1",
      triggerId: "t1",
      triggeredAt: 5,
    });
  });

  it("accepts trigger_failed shape", () => {
    expect(
      parseTriggerServerEvent({
        type: "trigger_failed",
        agentId: "a1",
        triggerId: "t1",
        error: "boom",
      }),
    ).toEqual({
      type: "trigger_failed",
      agentId: "a1",
      triggerId: "t1",
      error: "boom",
    });
  });

  it("rejects malformed trigger event", () => {
    expect(() =>
      parseTriggerServerEvent({ type: "trigger_failed", agentId: "a1" }),
    ).toThrow(/Invalid payload/);
  });
});
