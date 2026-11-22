import { describe, expect, it, vi } from "vitest";
import type { RpcClientFrame, RpcEventFrame, RpcServerFrame } from "@spherse/contracts";
import type { RpcTransport } from "../transport.js";
import { RpcClient } from "../client.js";

class FakeTransport implements RpcTransport {
  sent: RpcClientFrame[] = [];
  frameHandlers = new Set<(frame: RpcServerFrame) => void>();
  closedHandlers = new Set<() => void>();
  connect = vi.fn(async () => {});
  close = vi.fn();

  send(frame: RpcClientFrame): void {
    this.sent.push(frame);
  }

  onFrame(handler: (frame: RpcServerFrame) => void): () => void {
    this.frameHandlers.add(handler);
    return () => this.frameHandlers.delete(handler);
  }

  onClosed(handler: () => void): () => void {
    this.closedHandlers.add(handler);
    return () => this.closedHandlers.delete(handler);
  }

  emit(frame: RpcServerFrame): void {
    for (const handler of this.frameHandlers) handler(frame);
  }

  emitClosed(): void {
    for (const handler of this.closedHandlers) handler();
  }
}

function result(id: number, ok: boolean, data?: unknown, error?: { code: number; message: string }): RpcServerFrame {
  return {
    type: "result",
    id,
    ok,
    ...(data !== undefined ? { data } : {}),
    ...(error !== undefined ? { error } : {}),
  };
}

function event(scope: string, seq?: number): RpcEventFrame {
  return {
    type: "event",
    scope,
    event: "assistant_delta",
    payload: { text: "hi" },
    ...(seq !== undefined ? { seq } : {}),
    ts: 1000,
  };
}

describe("rpc client", () => {
  it("sends call frames with monotonic ids and resolves on result", async () => {
    const transport = new FakeTransport();
    const client = new RpcClient(transport);
    const first = client.call<{ ok: boolean }>("sessions.listProject", { projectId: "p1" });
    const second = client.call("sessions.search", { projectId: "p1", q: "x" });
    expect(transport.sent).toEqual([
      { type: "call", id: 1, method: "sessions.listProject", params: { projectId: "p1" } },
      { type: "call", id: 2, method: "sessions.search", params: { projectId: "p1", q: "x" } },
    ]);
    transport.emit(result(2, true, { results: [] }));
    transport.emit(result(1, true, { ok: true }));
    await expect(first).resolves.toEqual({ ok: true });
    await expect(second).resolves.toEqual({ results: [] });
  });

  it("rejects the pending call when result carries an error", async () => {
    const transport = new FakeTransport();
    const client = new RpcClient(transport);
    const pending = client.call("sessions.get", { projectId: "p", agentId: "a", sessionId: "s" });
    transport.emit(result(1, false, undefined, { code: 100, message: "Session not found" }));
    await expect(pending).rejects.toThrow("Session not found");
  });

  it("dispatches events only to matching scope handlers", () => {
    const transport = new FakeTransport();
    const client = new RpcClient(transport);
    const chatHandler = vi.fn();
    const otherHandler = vi.fn();
    client.onEvent("chat:p:a:s", chatHandler);
    client.onEvent("trigger:p", otherHandler);
    transport.emit(event("chat:p:a:s", 3));
    expect(chatHandler).toHaveBeenCalledTimes(1);
    expect(chatHandler.mock.calls[0][0]).toMatchObject({ seq: 3 });
    expect(otherHandler).not.toHaveBeenCalled();
  });

  it("subscribe resolves on snapshot and replays its events", async () => {
    const transport = new FakeTransport();
    const client = new RpcClient(transport);
    const handler = vi.fn();
    client.onEvent("chat:p:a:s", handler);
    const pending = client.subscribe("chat:p:a:s", { since: 5 });
    expect(transport.sent).toEqual([{ type: "sub", id: 1, scope: "chat:p:a:s", since: 5 }]);
    transport.emit({
      type: "snapshot",
      id: 1,
      events: [event("chat:p:a:s", 6), event("chat:p:a:s", 7)],
    });
    await expect(pending).resolves.toBeUndefined();
    expect(handler).toHaveBeenCalledTimes(2);
  });

  it("subscribe rejects when the server replies with an error result", async () => {
    const transport = new FakeTransport();
    const client = new RpcClient(transport);
    const pending = client.subscribe("chat:p:a:s");
    transport.emit(result(1, false, undefined, { code: -32000, message: "Scope not supported" }));
    await expect(pending).rejects.toThrow("Scope not supported");
  });

  it("resubscribeAll re-sends active subscriptions with fresh ids", async () => {
    const transport = new FakeTransport();
    const client = new RpcClient(transport);
    const first = client.subscribe("chat:p:a:s", { since: 2 });
    transport.emit({ type: "snapshot", id: 1, events: [] });
    await first;
    const all = client.resubscribeAll();
    expect(transport.sent.slice(-1)).toEqual([
      { type: "sub", id: 2, scope: "chat:p:a:s", since: 2 },
    ]);
    transport.emit({ type: "snapshot", id: 2, events: [] });
    await expect(all).resolves.toBeUndefined();
  });

  it("rejects all pending work when the transport closes", async () => {
    const transport = new FakeTransport();
    const client = new RpcClient(transport);
    const call = client.call("sessions.listProject", { projectId: "p" });
    const sub = client.subscribe("chat:p:a:s");
    transport.emitClosed();
    await expect(call).rejects.toThrow("rpc transport closed");
    await expect(sub).rejects.toThrow("rpc transport closed");
  });

  it("dispose rejects pending calls and closes the transport", async () => {
    const transport = new FakeTransport();
    const client = new RpcClient(transport);
    const call = client.call("sessions.listProject", { projectId: "p" });
    client.dispose();
    await expect(call).rejects.toThrow("rpc client disposed");
    expect(transport.close).toHaveBeenCalledTimes(1);
    expect(client.call("sessions.get")).rejects.toThrow("rpc client disposed");
  });

  it("ignores result frames for unknown ids", () => {
    const transport = new FakeTransport();
    new RpcClient(transport);
    expect(() => transport.emit(result(99, true, {}))).not.toThrow();
  });
});
