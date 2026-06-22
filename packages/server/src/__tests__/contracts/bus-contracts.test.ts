import { describe, expect, it } from "vitest";
import {
  parseBusClientMessage,
  parseBusServerMessage,
  parseScheduleServerEvent,
} from "../../contracts/index.js";

describe("bus server message contract", () => {
  it("accepts schedule_triggered envelope", () => {
    expect(
      parseBusServerMessage({
        channel: "schedule",
        projectId: "p1",
        type: "schedule_triggered",
        payload: { agentId: "a1", scheduleId: "s1", triggeredAt: 123 },
      }),
    ).toEqual({
      channel: "schedule",
      projectId: "p1",
      type: "schedule_triggered",
      payload: { agentId: "a1", scheduleId: "s1", triggeredAt: 123 },
    });
  });

  it("accepts schedule_triggered envelope with optional sessionId", () => {
    expect(
      parseBusServerMessage({
        channel: "schedule",
        projectId: "p1",
        type: "schedule_triggered",
        payload: { agentId: "a1", scheduleId: "s1", sessionId: "sess1", triggeredAt: 1 },
      }),
    ).toEqual({
      channel: "schedule",
      projectId: "p1",
      type: "schedule_triggered",
      payload: { agentId: "a1", scheduleId: "s1", sessionId: "sess1", triggeredAt: 1 },
    });
  });

  it("accepts schedule_completed envelope", () => {
    expect(
      parseBusServerMessage({
        channel: "schedule",
        projectId: "p1",
        type: "schedule_completed",
        payload: { agentId: "a1", scheduleId: "s1", sessionId: "sess1", status: "success" },
      }),
    ).toEqual({
      channel: "schedule",
      projectId: "p1",
      type: "schedule_completed",
      payload: { agentId: "a1", scheduleId: "s1", sessionId: "sess1", status: "success" },
    });
  });

  it("accepts schedule_failed envelope", () => {
    expect(
      parseBusServerMessage({
        channel: "schedule",
        projectId: "p1",
        type: "schedule_failed",
        payload: { agentId: "a1", scheduleId: "s1", error: "boom" },
      }),
    ).toEqual({
      channel: "schedule",
      projectId: "p1",
      type: "schedule_failed",
      payload: { agentId: "a1", scheduleId: "s1", error: "boom" },
    });
  });

  it("accepts schedule_updated envelope with optional schedule", () => {
    expect(
      parseBusServerMessage({
        channel: "schedule",
        projectId: "p1",
        type: "schedule_updated",
        payload: { agentId: "a1", scheduleId: "s1" },
      }),
    ).toEqual({
      channel: "schedule",
      projectId: "p1",
      type: "schedule_updated",
      payload: { agentId: "a1", scheduleId: "s1" },
    });
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
    expect(
      parseBusServerMessage({
        channel: "fs-watch",
        projectId: "p1",
        type: "change",
        payload: { eventType: "change", path: "/c.md" },
      }),
    ).toEqual({
      channel: "fs-watch",
      projectId: "p1",
      type: "change",
      payload: { eventType: "change", path: "/c.md" },
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

  it("rejects schedule envelope missing projectId", () => {
    expect(() =>
      parseBusServerMessage({
        channel: "schedule",
        type: "schedule_triggered",
        payload: { agentId: "a1", scheduleId: "s1", triggeredAt: 1 },
      }),
    ).toThrow(/Invalid payload/);
  });

  it("rejects schedule envelope with malformed payload", () => {
    expect(() =>
      parseBusServerMessage({
        channel: "schedule",
        projectId: "p1",
        type: "schedule_triggered",
        payload: { scheduleId: "s1", triggeredAt: 1 },
      }),
    ).toThrow(/Invalid payload/);
  });

  it("rejects schedule_completed with wrong status", () => {
    expect(() =>
      parseBusServerMessage({
        channel: "schedule",
        projectId: "p1",
        type: "schedule_completed",
        payload: { agentId: "a1", scheduleId: "s1", sessionId: "x", status: "failed" },
      }),
    ).toThrow(/Invalid payload/);
  });

  it("rejects fs-watch change with unknown eventType", () => {
    expect(() =>
      parseBusServerMessage({
        channel: "fs-watch",
        projectId: "p1",
        type: "change",
        payload: { eventType: "unlink", path: "/a" },
      }),
    ).toThrow(/Invalid payload/);
  });

  it("rejects debug envelope with missing payload line", () => {
    expect(() =>
      parseBusServerMessage({
        channel: "debug",
        type: "log",
        payload: {},
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
    for (const channel of ["schedule", "fs-watch", "debug"] as const) {
      expect(parseBusClientMessage({ kind: "subscribe", projectId: "p1", channel })).toEqual({
        kind: "subscribe",
        projectId: "p1",
        channel,
      });
    }
  });

  it("accepts unsubscribe messages across channels", () => {
    for (const channel of ["schedule", "fs-watch", "debug"] as const) {
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

  it("rejects subscribe missing projectId", () => {
    expect(() =>
      parseBusClientMessage({ kind: "subscribe", channel: "schedule" }),
    ).toThrow(/Invalid payload/);
  });

  it("rejects unknown kind", () => {
    expect(() => parseBusClientMessage({ kind: "bogus" })).toThrow(/Invalid payload/);
  });
});

describe("migrated schedule server event contract", () => {
  it("accepts the legacy top-level schedule_triggered shape", () => {
    expect(
      parseScheduleServerEvent({
        type: "schedule_triggered",
        agentId: "a1",
        scheduleId: "s1",
        triggeredAt: 5,
      }),
    ).toEqual({
      type: "schedule_triggered",
      agentId: "a1",
      scheduleId: "s1",
      triggeredAt: 5,
    });
  });

  it("accepts the legacy top-level schedule_failed shape", () => {
    expect(
      parseScheduleServerEvent({
        type: "schedule_failed",
        agentId: "a1",
        scheduleId: "s1",
        error: "boom",
      }),
    ).toEqual({
      type: "schedule_failed",
      agentId: "a1",
      scheduleId: "s1",
      error: "boom",
    });
  });

  it("rejects malformed legacy schedule event", () => {
    expect(() =>
      parseScheduleServerEvent({ type: "schedule_failed", agentId: "a1" }),
    ).toThrow(/Invalid payload/);
  });
});
