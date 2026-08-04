import { beforeEach, describe, expect, it, vi } from "vitest";

type EventModule = typeof import("../runtime/events.js");

interface PostedMessage {
  type: string;
  subscriptionId: string;
  event?: string;
  filter?: { path: string };
}

let messages: PostedMessage[];

async function useEvents(): Promise<EventModule> {
  const mod = await import("../runtime/events.js");
  mod.installEventListener();
  return mod;
}

beforeEach(() => {
  vi.resetModules();
  messages = [];
  Object.defineProperty(window, "parent", {
    value: {
      postMessage: vi.fn((message: PostedMessage) => {
        messages.push(message);
      }),
    },
    configurable: true,
  });
});

describe("events.on", () => {
  it("registers a filtered file:update subscription and returns an idempotent cleanup", async () => {
    const { events } = await useEvents();
    const cleanup = events.on("file:update", { path: "world/data.json" }, vi.fn());

    expect(messages[0]).toMatchObject({
      type: "spherse:event-subscribe",
      event: "file:update",
      filter: { path: "world/data.json" },
    });

    cleanup();
    cleanup();
    expect(messages.filter((message) => message.type === "spherse:event-unsubscribe")).toHaveLength(1);
    expect(messages[1].subscriptionId).toBe(messages[0].subscriptionId);
  });

  it("delivers only messages for the matching subscription id", async () => {
    const { events } = await useEvents();
    const handler = vi.fn();
    events.on("file:update", { path: "world/data.json" }, handler);
    const subscriptionId = messages[0].subscriptionId;

    window.dispatchEvent(new MessageEvent("message", {
      data: {
        type: "spherse:event",
        event: "file:update",
        subscriptionId: "other",
        payload: { path: "world/data.json" },
      },
    }));
    window.dispatchEvent(new MessageEvent("message", {
      data: {
        type: "spherse:event",
        event: "file:update",
        subscriptionId,
        payload: { path: "world/data.json" },
      },
    }));

    expect(handler).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledWith({
      path: "world/data.json",
    });
  });

  it("rejects invalid filters", async () => {
    const { events } = await useEvents();
    expect(() => events.on("file:update", { path: "" }, vi.fn())).toThrow(
      "spherse:invalid_event_filter",
    );
  });
});

describe("resolveEventPath", () => {
  it("preserves project-relative paths", async () => {
    const { resolveEventPath } = await useEvents();
    expect(resolveEventPath(
      "world/data.json",
      "http://localhost/api/projects/p1/preview/pages/dashboard.html",
    )).toBe("world/data.json");
  });

  it("resolves dot-relative paths against a preview document", async () => {
    const { resolveEventPath } = await useEvents();
    expect(resolveEventPath(
      "./data.json",
      "http://localhost/api/projects/p1/preview/pages/dashboard.html",
    )).toBe("pages/data.json");
    expect(resolveEventPath(
      "../shared/data.json",
      "http://localhost/api/projects/p1/preview/pages/dashboard.html",
    )).toBe("shared/data.json");
  });

  it("resolves authenticated srcDoc base URLs and decodes path segments", async () => {
    const { resolveEventPath } = await useEvents();
    expect(resolveEventPath(
      "./%E8%B5%84%E6%96%99.json",
      "http://localhost/api/projects/p1/preview/__auth/token/pages/",
    )).toBe("pages/资料.json");
  });

  it("rejects paths that escape the preview root or use an unrelated base", async () => {
    const { resolveEventPath } = await useEvents();
    expect(resolveEventPath(
      "../data.json",
      "http://localhost/api/projects/p1/preview/",
    )).toBeNull();
    expect(resolveEventPath("./data.json", "about:srcdoc")).toBeNull();
  });
});
