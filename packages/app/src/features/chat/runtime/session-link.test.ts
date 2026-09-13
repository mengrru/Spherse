import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createMockWebSocket,
  openInstance,
  type MockWebSocketInstance,
} from "../../../test/mock-web-socket";
import type { AgentEvent } from "../model/agent-event-parse";
import { createSessionLink, type SessionLinkParams } from "./session-link";

let mock: ReturnType<typeof createMockWebSocket>;

function params(overrides: Partial<SessionLinkParams> = {}): SessionLinkParams {
  return {
    client: {} as SessionLinkParams["client"],
    baseUrl: "http://localhost:5173",
    projectId: "p1",
    agentId: "a1",
    sessionId: "s1",
    accessToken: null,
    ...overrides,
  };
}

function harness(getParams: () => SessionLinkParams = () => params()) {
  const events: AgentEvent[] = [];
  const opened = vi.fn();
  const closed = vi.fn();
  const link = createSessionLink(getParams, {
    onOpen: opened,
    onClose: closed,
    onStateChange: () => {},
    onEvent: (event) => events.push(event),
    isAttached: () => true,
  });
  return { link, events, opened, closed };
}

function lastInstance(): MockWebSocketInstance {
  const instance = mock.instances[mock.instances.length - 1];
  if (!instance) throw new Error("no websocket instance");
  return instance;
}

describe("session link", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mock = createMockWebSocket();
    vi.stubGlobal("WebSocket", mock.MockWebSocket);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("opens the chat endpoint, decodes frames and encodes payloads", async () => {
    const h = harness();
    h.link.connect();
    await vi.advanceTimersByTimeAsync(0);
    openInstance(lastInstance());

    expect(lastInstance().url).toBe("ws://localhost:5173/ws/projects/p1/chat/a1/s1");
    expect(h.link.isOpen()).toBe(true);
    expect(h.opened).toHaveBeenCalledTimes(1);

    expect(h.link.send({ type: "ping" })).toBe(true);
    expect(JSON.parse(lastInstance().sent.at(-1)!)).toEqual({ type: "ping" });

    lastInstance().onmessage?.({ data: JSON.stringify({ type: "pong" }) } as MessageEvent);
    expect(h.events).toHaveLength(0);

    lastInstance().onmessage?.({ data: JSON.stringify({ type: "run_status", active: true }) } as MessageEvent);
    expect(h.events).toEqual([{ type: "run_status", active: true }]);
  });

  it("evaluates the url per connection so refreshed params are used", async () => {
    const h = harness(() => params({ accessToken: "token-1" }));
    h.link.connect();
    await vi.advanceTimersByTimeAsync(0);
    expect(lastInstance().url).toContain("token=token-1");
    h.link.dispose();

    const refreshed = harness(() => params({ accessToken: "token-2" }));
    refreshed.link.connect();
    await vi.advanceTimersByTimeAsync(0);
    expect(lastInstance().url).toContain("token=token-2");
  });

  it("does not reconnect fatal close codes", async () => {
    const h = harness();
    h.link.connect();
    await vi.advanceTimersByTimeAsync(0);
    openInstance(lastInstance());
    lastInstance().onclose?.({ code: 4401 } as CloseEvent);

    await vi.advanceTimersByTimeAsync(60_000);
    expect(mock.instances).toHaveLength(1);
    expect(h.closed).toHaveBeenCalledTimes(1);
  });

  it("sends false and does not throw when the socket is closed", () => {
    const h = harness();
    expect(h.link.send({ type: "ping" })).toBe(false);
    expect(h.link.isOpen()).toBe(false);
  });
});
