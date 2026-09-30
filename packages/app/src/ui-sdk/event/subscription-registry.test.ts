import { describe, expect, it, vi } from "vitest";
import {
  EventSubscriptionRegistry,
  MAX_EVENT_SUBSCRIPTIONS_PER_SOURCE,
} from "./subscription-registry";

function createSource() {
  return { postMessage: vi.fn() };
}

describe("EventSubscriptionRegistry", () => {
  it("delivers matching file updates only to their subscribed source", () => {
    const registry = new EventSubscriptionRegistry();
    const sourceA = createSource();
    const sourceB = createSource();
    registry.subscribe(sourceA, "a", "file:update", { path: "world/data.json" });
    registry.subscribe(sourceB, "b", "file:update", { path: "other/data.json" });

    registry.dispatchFileUpdate({ path: "world\\data.json", eventType: "change" });

    expect(sourceA.postMessage).toHaveBeenCalledWith({
      type: "spherse:event",
      event: "file:update",
      subscriptionId: "a",
      payload: { path: "world/data.json" },
    }, "*");
    expect(sourceB.postMessage).not.toHaveBeenCalled();
  });

  it("removes subscriptions and clears empty sources", () => {
    const registry = new EventSubscriptionRegistry();
    const source = createSource();
    registry.subscribe(source, "a", "file:update", { path: "world/data.json" });
    registry.unsubscribe(source, "a");
    registry.dispatchFileUpdate({ path: "world/data.json", eventType: "change" });
    expect(source.postMessage).not.toHaveBeenCalled();
  });

  it("rejects unsupported events, invalid paths, and excessive subscriptions", () => {
    const registry = new EventSubscriptionRegistry();
    const source = createSource();
    expect(registry.subscribe(source, "a", "session:update", { path: "x.json" })).toBe(false);
    expect(registry.subscribe(source, "a", "file:update", { path: "../x.json" })).toBe(false);

    for (let index = 0; index < MAX_EVENT_SUBSCRIPTIONS_PER_SOURCE; index += 1) {
      expect(
        registry.subscribe(source, `s${index}`, "file:update", { path: `data/${index}.json` }),
      ).toBe(true);
    }
    expect(registry.subscribe(source, "overflow", "file:update", { path: "overflow.json" }))
      .toBe(false);
  });

  it("accepts navigate subscriptions only without a filter", () => {
    const registry = new EventSubscriptionRegistry();
    const source = createSource();
    expect(registry.subscribe(source, "a", "navigate", undefined)).toBe(true);
    expect(registry.subscribe(source, "b", "navigate", null)).toBe(true);
    expect(registry.subscribe(source, "c", "navigate", {})).toBe(false);
    expect(registry.subscribe(source, "d", "navigate", { kind: "file" })).toBe(false);
  });

  it("counts navigate and file:update subscriptions against the same per-source limit", () => {
    const registry = new EventSubscriptionRegistry();
    const source = createSource();
    for (let index = 0; index < MAX_EVENT_SUBSCRIPTIONS_PER_SOURCE; index += 1) {
      registry.subscribe(source, `n${index}`, "navigate", undefined);
    }
    expect(registry.subscribe(source, "overflow", "file:update", { path: "overflow.json" }))
      .toBe(false);
  });

  it("replays the current navigate state on subscribe", () => {
    const registry = new EventSubscriptionRegistry();
    const source = createSource();
    registry.setNavigateCurrent({ kind: "file", path: "todo/事务簿.html" });

    registry.subscribe(source, "a", "navigate", undefined);

    expect(source.postMessage).toHaveBeenCalledWith({
      type: "spherse:event",
      event: "navigate",
      subscriptionId: "a",
      payload: { kind: "file", path: "todo/事务簿.html" },
    }, "*");
  });

  it("does not replay before a navigate state exists", () => {
    const registry = new EventSubscriptionRegistry();
    const source = createSource();
    registry.subscribe(source, "a", "navigate", undefined);
    expect(source.postMessage).not.toHaveBeenCalled();
  });

  it("broadcasts navigate state changes to navigate subscribers only", () => {
    const registry = new EventSubscriptionRegistry();
    const navigateSource = createSource();
    const fileSource = createSource();
    registry.subscribe(navigateSource, "n", "navigate", undefined);
    registry.subscribe(fileSource, "f", "file:update", { path: "world/data.json" });

    registry.setNavigateCurrent({ kind: "welcome" });

    expect(navigateSource.postMessage).toHaveBeenCalledWith({
      type: "spherse:event",
      event: "navigate",
      subscriptionId: "n",
      payload: { kind: "welcome" },
    }, "*");
    expect(fileSource.postMessage).not.toHaveBeenCalled();
  });

  it("skips identical navigate states and stops after unsubscribe", () => {
    const registry = new EventSubscriptionRegistry();
    const source = createSource();
    registry.subscribe(source, "a", "navigate", undefined);

    registry.setNavigateCurrent({ kind: "chat", sessionId: "s1" });
    registry.setNavigateCurrent({ kind: "chat", sessionId: "s1" });
    expect(source.postMessage).toHaveBeenCalledTimes(1);

    registry.unsubscribe(source, "a");
    registry.setNavigateCurrent({ kind: "welcome" });
    expect(source.postMessage).toHaveBeenCalledTimes(1);
  });

  it("clear resets subscriptions and the current navigate state", () => {
    const registry = new EventSubscriptionRegistry();
    const source = createSource();
    registry.setNavigateCurrent({ kind: "welcome" });
    registry.subscribe(source, "a", "navigate", undefined);
    expect(source.postMessage).toHaveBeenCalledTimes(1);

    registry.clear();

    registry.setNavigateCurrent({ kind: "file", path: "x.html" });
    expect(source.postMessage).toHaveBeenCalledTimes(1);
    expect(registry.subscribe(source, "b", "navigate", undefined)).toBe(true);
    expect(source.postMessage).toHaveBeenCalledWith({
      type: "spherse:event",
      event: "navigate",
      subscriptionId: "b",
      payload: { kind: "file", path: "x.html" },
    }, "*");
  });

  it("setNavigateCurrent(null) clears the replay state without broadcasting", () => {
    const registry = new EventSubscriptionRegistry();
    const source = createSource();
    registry.setNavigateCurrent({ kind: "welcome" });

    registry.setNavigateCurrent(null);
    registry.subscribe(source, "a", "navigate", undefined);

    expect(source.postMessage).not.toHaveBeenCalled();
  });
});
