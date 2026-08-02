import { describe, it, expect, vi } from "vitest";
import { SessionControlBus } from "../../session/control-bus.js";
import type { SessionControlEvent } from "../../session/types.js";

describe("SessionControlBus", () => {
  it("resolves a pending request via resolve()", async () => {
    const bus = new SessionControlBus();
    const p = bus.request(
      { requestId: "r1", kind: "approval", toolCallId: "tc1", toolName: "run_command", args: { command: "echo" } },
      60_000,
      { approved: false, reason: "approval timeout" },
    );
    expect(bus.pendingCount).toBe(1);
    bus.resolve("r1", { approved: true });
    const decision = await p;
    expect(decision).toEqual({ approved: true });
    expect(bus.pendingCount).toBe(0);
  });

  it("ignores resolve() for unknown requestId", () => {
    const bus = new SessionControlBus();
    expect(() => bus.resolve("nope", { approved: false })).not.toThrow();
  });

  it("resolves with timeoutDecision when the timer fires", async () => {
    const bus = new SessionControlBus();
    const p = bus.request(
      { requestId: "r2", kind: "approval", toolCallId: "tc2", toolName: "run_command", args: {} },
      40,
      { approved: false, reason: "approval timeout" },
    );
    const decision = await p;
    expect(decision).toEqual({ approved: false, reason: "approval timeout" });
    expect(bus.pendingCount).toBe(0);
  });

  it("rejects all pending requests on rejectAll()", async () => {
    const bus = new SessionControlBus();
    const p = bus.request(
      { requestId: "r3", kind: "approval", toolCallId: "tc3", toolName: "run_command", args: {} },
      60_000,
      { approved: false, reason: "approval timeout" },
    );
    bus.rejectAll("session aborted");
    await expect(p).rejects.toThrow("session aborted");
    expect(bus.pendingCount).toBe(0);
  });

  it("emits control_request on request and control_resolved on resolve", async () => {
    const bus = new SessionControlBus();
    const events: SessionControlEvent[] = [];
    bus.setEventSink((e) => events.push(e));
    const p = bus.request(
      { requestId: "r4", kind: "approval", toolCallId: "tc4", toolName: "run_command", args: { command: "ls" } },
      60_000,
      { approved: false, reason: "approval timeout" },
    );
    bus.resolve("r4", { approved: true });
    await p;
    bus.setEventSink(null);
    expect(events).toEqual([
      { type: "control_request", requestId: "r4", kind: "approval", toolCallId: "tc4", toolName: "run_command", args: { command: "ls" } },
      { type: "control_resolved", requestId: "r4", kind: "approval", approved: true, reason: undefined },
    ]);
  });

  it("isolates concurrent requests by requestId", async () => {
    const bus = new SessionControlBus();
    const p1 = bus.request({ requestId: "a", kind: "approval", toolCallId: "t1", toolName: "run_command", args: {} }, 60_000, { approved: false });
    const p2 = bus.request({ requestId: "b", kind: "approval", toolCallId: "t2", toolName: "run_command", args: {} }, 60_000, { approved: false });
    bus.resolve("b", { approved: true });
    const d2 = await p2;
    bus.resolve("a", { approved: false });
    const d1 = await p1;
    expect(d2).toEqual({ approved: true });
    expect(d1).toEqual({ approved: false });
  });

  it("does not emit after sink is cleared", async () => {
    const bus = new SessionControlBus();
    const sink = vi.fn();
    bus.setEventSink(sink);
    bus.setEventSink(null);
    const p = bus.request({ requestId: "r5", kind: "approval", toolCallId: "t", toolName: "run_command", args: {} }, 60_000, { approved: false });
    bus.resolve("r5", { approved: false });
    await p;
    expect(sink).not.toHaveBeenCalled();
  });
});
