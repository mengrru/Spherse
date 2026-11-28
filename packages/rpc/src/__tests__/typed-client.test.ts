import { describe, expect, expectTypeOf, it, vi } from "vitest";
import { createTypedRpcClient } from "../typed-client.js";
import type { RpcClient } from "../index.js";

function fakeClient(result: unknown): RpcClient {
  return {
    call: vi.fn().mockResolvedValue(result),
    connect: vi.fn().mockResolvedValue(undefined),
    dispose: vi.fn(),
    subscribe: vi.fn(),
    unsubscribe: vi.fn(),
    onEvent: vi.fn().mockReturnValue(() => undefined),
    onReopen: vi.fn().mockReturnValue(() => undefined),
    onClosed: vi.fn().mockReturnValue(() => undefined),
  } as unknown as RpcClient;
}

describe("TypedRpcClient", () => {
  it("infers result types from the method map", async () => {
    const typed = createTypedRpcClient(fakeClient({ authRequired: false, serverVersion: "0.1.0", apiVersion: "1", appVersion: null }));
    const info = await typed.call("connection.info");
    expectTypeOf(info).toMatchTypeOf<{ authRequired: boolean; apiVersion: string }>();
    expect(info.authRequired).toBe(false);
  });

  it("parses results against the contract schema at runtime", async () => {
    const typed = createTypedRpcClient(fakeClient({ nope: true }));
    await expect(typed.call("connection.info")).rejects.toThrow();
  });

  it("accepts params-less calls for empty param schemas", async () => {
    const inner = fakeClient([]);
    const typed = createTypedRpcClient(inner);
    const projects = await typed.call("connection.projects");
    expectTypeOf(projects).toMatchTypeOf<Array<{ id: string }>>();
    expect(projects).toEqual([]);
  });
});
