import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RpcClientFrame, RpcServerFrame } from "@spherse/contracts";
import { RpcClient, type RpcTransport } from "@spherse/rpc";
import { useBusStore } from "./bus-store";
import { getSharedRpcClient } from "../lib/rpc/shared";

vi.mock("../lib/rpc/enabled", () => ({ isRpcClientEnabled: () => true }));
vi.mock("../lib/rpc/shared", () => ({ getSharedRpcClient: vi.fn() }));
vi.mock("../lib/host-bridge", () => ({}));

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

function createClient() {
  const transport = new FakeTransport();
  const client = new RpcClient(transport);
  return { transport, client };
}

function bridge(baseUrl = "http://x") {
  return {
    getServerBaseUrl: vi.fn(async () => baseUrl),
    getServerAccessToken: vi.fn(async () => null),
  } as never;
}

async function tick(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("bus store rpc mode", () => {
  beforeEach(() => {
    useBusStore.getState().teardown();
    vi.clearAllMocks();
  });

  it("subscribes bus scopes and dispatches events by project+channel", async () => {
    const { transport, client } = createClient();
    vi.mocked(getSharedRpcClient).mockReturnValue(client);
    await useBusStore.getState().init(bridge());
    await tick();

    const handler = vi.fn();
    useBusStore.getState().addHandler("p1", "trigger", handler);
    await tick();
    expect(transport.sent).toContainEqual({
      type: "sub",
      id: 1,
      scope: "bus:p1:trigger",
    });
    transport.emit({ type: "snapshot", id: 1, events: [] });
    await tick();

    transport.emit({
      type: "event",
      scope: "bus:p1:trigger",
      event: "trigger_triggered",
      payload: { triggerId: "t1" },
      ts: 1,
    });
    expect(handler).toHaveBeenCalledWith("trigger_triggered", { triggerId: "t1" });
  });

  it("removing the last handler unsubscribes the scope", async () => {
    const { transport, client } = createClient();
    vi.mocked(getSharedRpcClient).mockReturnValue(client);
    await useBusStore.getState().init(bridge());
    await tick();

    const handler = vi.fn();
    useBusStore.getState().addHandler("p1", "session", handler);
    await tick();
    useBusStore.getState().removeHandler("p1", "session", handler);
    await tick();
    const unsubs = transport.sent.filter((f) => f.type === "unsub");
    expect(unsubs).toHaveLength(1);
    expect(unsubs[0]).toMatchObject({ scope: "bus:p1:session" });
  });

  it("emits trigger events through the bus method", async () => {
    const { transport, client } = createClient();
    vi.mocked(getSharedRpcClient).mockReturnValue(client);
    await useBusStore.getState().init(bridge());
    await tick();
    useBusStore.getState().emitAgentTriggerEvent("p1", "user-event", "data");
    await tick();
    expect(transport.sent).toContainEqual({
      type: "call",
      id: 1,
      method: "bus.emitTriggerEvent",
      params: { projectId: "p1", eventName: "user-event", payload: "data" },
    });
  });

  it("resubscribes all scopes on reopen and bumps resumedAt", async () => {
    const { transport, client } = createClient();
    vi.mocked(getSharedRpcClient).mockReturnValue(client);
    await useBusStore.getState().init(bridge());
    await tick();
    const handler = vi.fn();
    useBusStore.getState().addHandler("p1", "agent", handler);
    await tick();
    transport.emit({ type: "snapshot", id: 1, events: [] });
    await tick();

    const before = useBusStore.getState().resumedAt;
    transport.emitReopen();
    await tick();
    const subs = transport.sent.filter((f) => f.type === "sub");
    expect(subs).toHaveLength(2);
    expect(useBusStore.getState().resumedAt).toBeGreaterThanOrEqual(before ?? 0);
    expect(useBusStore.getState().status).toBe("open");
  });
});
