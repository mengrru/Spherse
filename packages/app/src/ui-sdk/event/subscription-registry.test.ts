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
});
