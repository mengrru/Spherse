import type { FsWatchChangeEvent } from "@spherse/server/contracts";
import { normalizeEventPath } from "./file-update";
import type {
  EventSourceWindow,
  FileUpdatePushMessage,
  FileUpdateSubscription,
} from "./types";

export const MAX_EVENT_SUBSCRIPTIONS_PER_SOURCE = 100;

export class EventSubscriptionRegistry {
  private readonly bySource = new Map<EventSourceWindow, Map<string, FileUpdateSubscription>>();

  subscribe(
    source: EventSourceWindow,
    subscriptionId: string,
    event: string,
    filter: unknown,
  ): boolean {
    if (event !== "file:update" || !subscriptionId) return false;
    const pathValue = (filter as { path?: unknown } | null)?.path;
    if (typeof pathValue !== "string") return false;
    const path = normalizeEventPath(pathValue);
    if (!path) return false;

    let subscriptions = this.bySource.get(source);
    if (!subscriptions) {
      subscriptions = new Map();
      this.bySource.set(source, subscriptions);
    }
    if (
      !subscriptions.has(subscriptionId)
      && subscriptions.size >= MAX_EVENT_SUBSCRIPTIONS_PER_SOURCE
    ) {
      return false;
    }
    subscriptions.set(subscriptionId, { event, path });
    return true;
  }

  unsubscribe(source: EventSourceWindow, subscriptionId: string): void {
    const subscriptions = this.bySource.get(source);
    if (!subscriptions) return;
    subscriptions.delete(subscriptionId);
    if (subscriptions.size === 0) this.bySource.delete(source);
  }

  dispatchFileUpdate(payload: FsWatchChangeEvent): void {
    const path = normalizeEventPath(payload.path);
    if (!path) return;
    for (const [source, subscriptions] of this.bySource) {
      for (const [subscriptionId, subscription] of subscriptions) {
        if (subscription.path !== path) continue;
        const message: FileUpdatePushMessage = {
          type: "spherse:event",
          event: subscription.event,
          subscriptionId,
          payload: { path },
        };
        source.postMessage(message, "*");
      }
    }
  }

  clear(): void {
    this.bySource.clear();
  }
}
