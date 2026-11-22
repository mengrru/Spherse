import { describe, expect, it, vi } from "vitest";
import { busScope } from "@spherse/contracts";
import { busMethods } from "../methods/bus.js";
import { createRpcHarness, createBusSourceMock, flush } from "../testing.js";

describe("rpc bus scopes", () => {
  it("subscribes bus scopes through the bus source and acks with a snapshot", () => {
    const bus = createBusSourceMock();
    const { receive, sent } = createRpcHarness({ busSource: bus.source });
    receive({ type: "sub", id: 1, scope: busScope("p1", "trigger") });
    expect(bus.mock.attach).toHaveBeenCalledWith(
      "p1",
      "trigger",
      expect.any(Function),
    );
    expect(sent()[0]).toEqual({ type: "snapshot", id: 1, events: [] });
  });

  it("forwards bus events as rpc event frames", () => {
    const bus = createBusSourceMock();
    const { receive, sent } = createRpcHarness({ busSource: bus.source });
    receive({ type: "sub", id: 1, scope: busScope("p1", "agent") });
    bus.mock.emit({ type: "agent_updated", payload: { agentId: "a1", action: "updated" } });
    expect(sent()[1]).toMatchObject({
      type: "event",
      scope: "bus:p1:agent",
      event: "agent_updated",
      payload: { agentId: "a1", action: "updated" },
    });
  });

  it("rejects bus scopes when the host provides no bus source", () => {
    const { receive, sent } = createRpcHarness();
    receive({ type: "sub", id: 1, scope: busScope("p1", "trigger") });
    expect(sent()[0]).toMatchObject({
      type: "result",
      id: 1,
      ok: false,
      error: { code: -32000 },
    });
  });

  it("maps bus attach failures to app error codes", () => {
    const failing = {
      attach: vi.fn(() => ({ ok: false as const, error: "Unknown project: nope" })),
    };
    const { receive, sent } = createRpcHarness({ busSource: failing });
    receive({ type: "sub", id: 1, scope: busScope("nope", "session") });
    expect(sent()[0]).toMatchObject({
      type: "result",
      id: 1,
      ok: false,
      error: { code: 100, message: "Unknown project: nope" },
    });
  });

  it("unsubscribes and connection close detach bus sources", () => {
    const bus = createBusSourceMock();
    const { handler, receive } = createRpcHarness({ busSource: bus.source });
    receive({ type: "sub", id: 1, scope: busScope("p1", "debug") });
    receive({ type: "unsub", id: 2, scope: busScope("p1", "debug") });
    expect(bus.mock.detach).toHaveBeenCalledTimes(1);
    receive({ type: "sub", id: 3, scope: busScope("p1", "fs-watch") });
    handler.onClose();
    expect(bus.mock.detach).toHaveBeenCalledTimes(2);
  });

  it("emits trigger events via bus.emitTriggerEvent", async () => {
    const { receive, sent, known } = createRpcHarness({
      methods: busMethods,
    });
    receive({
      type: "call",
      id: 1,
      method: "bus.emitTriggerEvent",
      params: { projectId: "p1", eventName: "user-event", payload: "hello" },
    });
    await flush();
    expect((known.triggerManager as { onUserEvent: ReturnType<typeof vi.fn> }).onUserEvent).toHaveBeenCalledWith(
      "user-event",
      "hello",
    );
    expect(sent()[0]).toMatchObject({ type: "result", id: 1, ok: true });
  });
});
