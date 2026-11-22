import { describe, expect, it, vi } from "vitest";
import type { RpcClientFrame, RpcServerFrame } from "@spherse/contracts";
import type { RpcTransport } from "@spherse/rpc";
import { RpcClient } from "@spherse/rpc";
import { createRpcSessionLink } from "./session-link-rpc";
import type { SessionLinkHandlers, SessionLinkParams } from "./session-link";

class FakeTransport implements RpcTransport {
  sent: RpcClientFrame[] = [];
  frameHandlers = new Set<(frame: RpcServerFrame) => void>();
  closedHandlers = new Set<() => void>();
  reopenHandlers = new Set<() => void>();
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

  onReopen(handler: () => void): () => void {
    this.reopenHandlers.add(handler);
    return () => this.reopenHandlers.delete(handler);
  }

  emit(frame: RpcServerFrame): void {
    for (const handler of this.frameHandlers) handler(frame);
  }

  emitReopen(): void {
    for (const handler of this.reopenHandlers) handler();
  }
}

const PARAMS: SessionLinkParams = {
  client: {} as SessionLinkParams["client"],
  baseUrl: "http://x",
  projectId: "p1",
  agentId: "a1",
  sessionId: "s1",
  accessToken: null,
};

function createHarness(handlerOverrides: Partial<SessionLinkHandlers> = {}) {
  const transport = new FakeTransport();
  const client = new RpcClient(transport);
  const handlers: SessionLinkHandlers = {
    onOpen: vi.fn(),
    onClose: vi.fn(),
    onStateChange: vi.fn(),
    onFrame: vi.fn(),
    getSince: vi.fn(() => undefined),
    isAttached: vi.fn(() => true),
    ...handlerOverrides,
  };
  const link = createRpcSessionLink(() => PARAMS, handlers, () => client);
  return { link, transport, client, handlers };
}

function event(scope: string, payload: unknown): RpcServerFrame {
  return { type: "event", scope, event: "x", payload, ts: 1 };
}

async function flush(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve));
}

describe("rpc session link", () => {
  it("subscribes with since and reports open after the snapshot ack", async () => {
    const { link, transport, handlers } = createHarness({
      getSince: vi.fn(() => 7),
    });
    link.connect();
    const sub = transport.sent.find((f): f is Extract<typeof f, { type: "sub" }> => f.type === "sub");
    expect(sub).toEqual({ type: "sub", id: 1, scope: "chat:p1:a1:s1", since: 7 });
    if (!sub) throw new Error("sub frame missing");
    transport.emit({ type: "snapshot", id: sub.id, events: [] });
    await flush();
    expect(handlers.onOpen).toHaveBeenCalledWith(7);
    expect(link.isOpen()).toBe(true);
  });

  it("decodes forwarded chat events from the scope payload", () => {
    const { link, transport, handlers } = createHarness();
    link.connect();
    transport.emit(event("chat:p1:a1:s1", { type: "session_ready", lastSeq: 4, replay: true }));
    expect(handlers.onFrame).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "session-ready", lastSeq: 4 }),
    );
    transport.emit(event("chat:other:a:s", { type: "session_ready", lastSeq: 9, replay: false }));
    expect(handlers.onFrame).toHaveBeenCalledTimes(1);
  });

  it("maps client messages to chat methods", async () => {
    const { link, transport } = createHarness();
    link.connect();
    link.send({ type: "message", content: "hi", clientId: "c1" });
    link.send({ type: "retry" });
    link.send({ type: "withdraw" });
    link.send({ type: "abort" });
    link.send({
      type: "resolve_control_request",
      requestId: "r1",
      kind: "approval",
      approved: true,
    });
    link.send({ type: "resolve_control_request", requestId: "r2", kind: "question", answer: "yes" });
    const calls = transport.sent.filter((f) => f.type === "call");
    expect(calls.map((c) => (c as { method: string }).method)).toEqual([
      "chat.send",
      "chat.retry",
      "chat.withdraw",
      "chat.abort",
      "chat.resolveControlRequest",
      "chat.resolveControlRequest",
    ]);
    expect((calls[0] as { params: unknown }).params).toEqual({
      projectId: "p1",
      agentId: "a1",
      sessionId: "s1",
      content: "hi",
      clientId: "c1",
    });
    expect((calls[4] as { params: unknown }).params).toMatchObject({
      requestId: "r1",
      kind: "approval",
      approved: true,
    });
    expect((calls[5] as { params: unknown }).params).toMatchObject({
      requestId: "r2",
      kind: "question",
      answer: "yes",
    });
  });

  it("surfaces call failures as error frames", async () => {
    const { link, transport, handlers } = createHarness();
    link.connect();
    const call = transport.sent.find((f) => f.type === "call") as { id: number };
    expect(call).toBeUndefined();
    link.send({ type: "message", content: "hi" });
    const callFrame = transport.sent.find((f) => f.type === "call") as { id: number };
    transport.emit({
      type: "result",
      id: callFrame.id,
      ok: false,
      error: { code: 102, message: "Not subscribed to session" },
    });
    await flush();
    expect(handlers.onFrame).toHaveBeenCalledWith(expect.objectContaining({ kind: "event" }));
  });

  it("resubscribes with a fresh since on transport reopen", async () => {
    const { link, transport, handlers } = createHarness({
      getSince: vi.fn()
        .mockReturnValueOnce(undefined)
        .mockReturnValue(12),
    });
    link.connect();
    transport.emit({ type: "snapshot", id: 1, events: [] });
    await flush();
    transport.emitReopen();
    const subs = transport.sent.filter((f) => f.type === "sub");
    expect(subs).toHaveLength(2);
    expect(subs[1]).toMatchObject({ scope: "chat:p1:a1:s1", since: 12 });
    transport.emit({ type: "snapshot", id: subs[1].id, events: [] });
    await flush();
    expect(handlers.onOpen).toHaveBeenCalledTimes(2);
  });

  it("dispose unsubscribes and stops delivering events", async () => {
    const { link, transport, handlers } = createHarness();
    link.connect();
    transport.emit({ type: "snapshot", id: 1, events: [] });
    await flush();
    link.dispose();
    const unsub = transport.sent.find((f) => f.type === "unsub");
    expect(unsub).toMatchObject({ scope: "chat:p1:a1:s1" });
    transport.emit(event("chat:p1:a1:s1", { type: "session_ready", lastSeq: 4, replay: true }));
    expect(handlers.onFrame).toHaveBeenCalledTimes(0);
    expect(link.send({ type: "message", content: "x" })).toBe(false);
  });
});
