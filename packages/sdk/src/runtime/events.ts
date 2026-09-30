/* eslint-disable no-redeclare */
import { SDK_VERSION } from "../meta.js";

export interface FileUpdateEvent {
  path: string;
}

export type NavigateEvent =
  | { kind: "welcome" }
  | { kind: "chat"; sessionId: string }
  | { kind: "file"; path: string }
  | { kind: "browser"; url: string };

interface FileUpdateSubscription {
  event: "file:update";
  filter: { path: string };
  handler: (payload: FileUpdateEvent) => void | Promise<void>;
}

interface NavigateSubscription {
  event: "navigate";
  handler: (payload: NavigateEvent) => void | Promise<void>;
}

type Subscription = FileUpdateSubscription | NavigateSubscription;

type EventMessage =
  | {
      type: "spherse:event";
      event: "file:update";
      subscriptionId: string;
      payload: FileUpdateEvent;
    }
  | {
      type: "spherse:event";
      event: "navigate";
      subscriptionId: string;
      payload: NavigateEvent;
    };

const subscriptions = new Map<string, Subscription>();

export function resolveEventPath(input: string, baseUri: string): string | null {
  if (!input.startsWith("./") && !input.startsWith("../")) return input;

  let resolved: URL;
  try {
    resolved = new URL(input, baseUri);
  } catch {
    return null;
  }

  const segments = resolved.pathname.split("/").filter(Boolean);
  const previewIndex = segments.lastIndexOf("preview");
  if (previewIndex < 0) return null;

  let projectSegments = segments.slice(previewIndex + 1);
  if (projectSegments[0] === "__auth") {
    if (projectSegments.length < 3) return null;
    projectSegments = projectSegments.slice(2);
  }
  if (projectSegments.length === 0) return null;

  try {
    const decoded = projectSegments.map((segment) => decodeURIComponent(segment));
    if (decoded.some((segment) => segment.includes("/") || segment.includes("\\"))) return null;
    return decoded.join("/");
  } catch {
    return null;
  }
}

function genId(): string {
  return "e" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function postControl(
  type: "spherse:event-subscribe" | "spherse:event-unsubscribe",
  subscriptionId: string,
  subscription?: Subscription,
): void {
  window.parent.postMessage(
    {
      type,
      subscriptionId,
      event: subscription?.event,
      filter: subscription?.event === "file:update" ? subscription.filter : undefined,
      sdk: SDK_VERSION,
    },
    "*",
  );
}

function registerSubscription(subscription: Subscription): () => void {
  const subscriptionId = genId();
  subscriptions.set(subscriptionId, subscription);
  postControl("spherse:event-subscribe", subscriptionId, subscription);

  let active = true;
  return () => {
    if (!active) return;
    active = false;
    subscriptions.delete(subscriptionId);
    postControl("spherse:event-unsubscribe", subscriptionId);
  };
}

export function on(
  event: "file:update",
  filter: { path: string },
  handler: (payload: FileUpdateEvent) => void | Promise<void>,
): () => void;
export function on(
  event: "navigate",
  handler: (payload: NavigateEvent) => void | Promise<void>,
): () => void;
export function on(
  event: string,
  filterOrHandler: unknown,
  maybeHandler?: unknown,
): () => void {
  if (event === "file:update") {
    const filter = filterOrHandler as { path?: unknown } | null | undefined;
    if (!filter || typeof filter.path !== "string" || !filter.path.trim()) {
      throw new Error("spherse:invalid_event_filter");
    }
    if (typeof maybeHandler !== "function") throw new Error("spherse:invalid_event_handler");
    const path = resolveEventPath(filter.path, document.baseURI);
    if (!path) throw new Error("spherse:invalid_event_filter");
    return registerSubscription({
      event,
      filter: { path },
      handler: maybeHandler as (payload: FileUpdateEvent) => void | Promise<void>,
    });
  }

  if (event === "navigate") {
    if (typeof filterOrHandler !== "function") throw new Error("spherse:invalid_event_handler");
    return registerSubscription({
      event,
      handler: filterOrHandler as (payload: NavigateEvent) => void | Promise<void>,
    });
  }

  throw new Error("spherse:unsupported_event");
}

export function installEventListener(): void {
  window.addEventListener("message", (event: MessageEvent) => {
    const data = event.data as EventMessage | null;
    if (
      !data
      || data.type !== "spherse:event"
      || (data.event !== "file:update" && data.event !== "navigate")
    ) {
      return;
    }
    const subscription = subscriptions.get(data.subscriptionId);
    if (!subscription) return;
    if (subscription.event !== data.event) return;
    const handler = subscription.handler as (
      payload: FileUpdateEvent | NavigateEvent,
    ) => void | Promise<void>;
    try {
      void Promise.resolve(handler(data.payload)).catch(() => undefined);
    } catch {
      return;
    }
  });

  window.addEventListener("pagehide", () => {
    for (const [subscriptionId] of subscriptions) {
      postControl("spherse:event-unsubscribe", subscriptionId);
    }
    subscriptions.clear();
  });
}

export const events = { on };
