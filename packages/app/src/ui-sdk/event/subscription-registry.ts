import type { FsWatchChangeEvent } from "@spherse/contracts";
import { normalizeEventPath } from "./file-update";
import type {
  EventSourceWindow,
  EventSubscription,
  FileUpdatePushMessage,
  NavigatePushMessage,
  SdkNavigateEvent,
} from "./types";

export const MAX_EVENT_SUBSCRIPTIONS_PER_SOURCE = 100;

function sameNavigate(a: SdkNavigateEvent | null, b: SdkNavigateEvent): boolean {
  if (!a || a.kind !== b.kind) return false;
  if (a.kind === "file" && b.kind === "file") return a.path === b.path;
  if (a.kind === "chat" && b.kind === "chat") return a.sessionId === b.sessionId;
  if (a.kind === "browser" && b.kind === "browser") return a.url === b.url;
  return true;
}

function pushNavigate(
  source: EventSourceWindow,
  subscriptionId: string,
  payload: SdkNavigateEvent,
): void {
  const message: NavigatePushMessage = {
    type: "spherse:event",
    event: "navigate",
    subscriptionId,
    payload,
  };
  source.postMessage(message, "*");
}

export class EventSubscriptionRegistry {
  private readonly bySource = new Map<EventSourceWindow, Map<string, EventSubscription>>();
  private currentNavigate: SdkNavigateEvent | null = null;

  subscribe(
    source: EventSourceWindow,
    subscriptionId: string,
    event: string,
    filter: unknown,
  ): boolean {
    if (!subscriptionId) return false;

    let subscription: EventSubscription;
    if (event === "file:update") {
      const pathValue = (filter as { path?: unknown } | null | undefined)?.path;
      if (typeof pathValue !== "string") return false;
      const path = normalizeEventPath(pathValue);
      if (!path) return false;
      subscription = { event, path };
    } else if (event === "navigate") {
      if (filter !== undefined && filter !== null) return false;
      subscription = { event };
    } else {
      return false;
    }

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
    subscriptions.set(subscriptionId, subscription);
    if (subscription.event === "navigate" && this.currentNavigate) {
      pushNavigate(source, subscriptionId, this.currentNavigate);
    }
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
        if (subscription.event !== "file:update" || subscription.path !== path) continue;
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

  setNavigateCurrent(payload: SdkNavigateEvent | null): void {
    if (!payload) {
      this.currentNavigate = null;
      return;
    }
    if (sameNavigate(this.currentNavigate, payload)) return;
    this.currentNavigate = payload;
    for (const [source, subscriptions] of this.bySource) {
      for (const [subscriptionId, subscription] of subscriptions) {
        if (subscription.event !== "navigate") continue;
        pushNavigate(source, subscriptionId, payload);
      }
    }
  }

  clear(): void {
    this.bySource.clear();
    this.currentNavigate = null;
  }
}
