import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { call, fire, installResponseListener, postAction } from "../runtime/messaging.js";

/**
 * messaging.ts is the SDK's request/response core: it tags calls with ids, matches
 * incoming `spherse:response` messages, and enforces a timeout. These tests stub the
 * `window.parent.postMessage` sink and simulate host replies by dispatching `message`
 * events on the sdk's own window (the listener is installed on `window`).
 */

type ActionMsg = {
  type: "spherse:action";
  action: string;
  params: Record<string, unknown>;
  sdk: string;
  requestId?: string;
};

let postMessage: ReturnType<typeof vi.fn>;
let messages: ActionMsg[];

function simulateResponse(requestId: string, ok: boolean, data?: unknown): void {
  window.dispatchEvent(
    new MessageEvent("message", {
      data: { type: "spherse:response", requestId, ok, data },
    }),
  );
}

beforeEach(() => {
  messages = [];
  postMessage = vi.fn((msg: ActionMsg) => {
    messages.push(msg);
  });
  // jsdom: window.parent === window, so the listener (on window) sees our simulated replies.
  Object.defineProperty(window, "parent", {
    value: { postMessage },
    configurable: true,
  });
  installResponseListener();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("postAction", () => {
  it("posts a spherse:action message with sdk version and empty params", () => {
    postAction("openFile", null, null);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({ type: "spherse:action", action: "openFile" });
    expect(messages[0].params).toEqual({});
    expect(messages[0].sdk).toBe("1");
    expect(messages[0].requestId).toBeUndefined();
  });

  it("includes requestId only when provided", () => {
    postAction("data.get", { key: "x" }, "req-1");
    expect(messages[0].requestId).toBe("req-1");
    expect(messages[0].params).toEqual({ key: "x" });
  });
});

describe("fire", () => {
  it("sends an action without a requestId (no reply expected)", () => {
    fire("openFile", { path: "/a" });
    expect(messages[0].requestId).toBeUndefined();
    expect(messages[0].action).toBe("openFile");
  });
});

describe("call", () => {
  it("resolves with data when the host replies ok:true", async () => {
    const p = call("data.get", { key: "x" });
    expect(messages[0].requestId).toBeTruthy();
    simulateResponse(messages[0].requestId!, true, { value: 42 });
    await expect(p).resolves.toEqual({ value: 42 });
  });

  it("rejects with the host error when ok:false", async () => {
    const p = call("data.get", { key: "x" });
    simulateResponse(messages[0].requestId!, false, { error: "not_found" });
    await expect(p).rejects.toThrow("not_found");
  });

  it("falls back to a generic error message when none is provided", async () => {
    const p = call("data.get", { key: "x" });
    simulateResponse(messages[0].requestId!, false);
    await expect(p).rejects.toThrow("spherse:error");
  });

  it("matches responses by requestId, so concurrent calls don't cross-wire", async () => {
    const pA = call("data.get", { key: "a" });
    const pB = call("data.get", { key: "b" });
    const idA = messages[0].requestId!;
    const idB = messages[1].requestId!;
    expect(idA).not.toBe(idB);

    // Host replies in reverse order.
    simulateResponse(idB, true, "B");
    simulateResponse(idA, true, "A");
    await expect(pA).resolves.toBe("A");
    await expect(pB).resolves.toBe("B");
  });

  it("ignores responses for unknown request ids", async () => {
    const p = call("data.get", { key: "x" });
    simulateResponse("bogus", true, "nope");
    simulateResponse(messages[0].requestId!, true, "real");
    await expect(p).resolves.toBe("real");
  });

  it("rejects with spherse:timeout when no reply arrives in time", async () => {
    vi.useFakeTimers();
    const p = call("data.get", { key: "x" }, 50);
    vi.advanceTimersByTime(50);
    await expect(p).rejects.toThrow("spherse:timeout");
  });

  it("clears the timeout when the reply arrives first", async () => {
    vi.useFakeTimers();
    const p = call("data.get", { key: "x" }, 50);
    simulateResponse(messages[0].requestId!, true, "ok");
    await expect(p).resolves.toBe("ok");
    // Advancing past the timeout must not throw an unhandled rejection.
    vi.advanceTimersByTime(100);
  });
});
