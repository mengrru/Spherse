import { SDK_VERSION } from "../meta.js";

export interface FileUpdateEvent {
  path: string;
}

type EventHandler = (payload: FileUpdateEvent) => void | Promise<void>;

interface Subscription {
  event: "file:update";
  filter: { path: string };
  handler: EventHandler;
}

interface EventMessage {
  type: "spherse:event";
  event: "file:update";
  subscriptionId: string;
  payload: FileUpdateEvent;
}

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
      filter: subscription?.filter,
      sdk: SDK_VERSION,
    },
    "*",
  );
}

function on(
  event: "file:update",
  filter: { path: string },
  handler: EventHandler,
): () => void {
  if (event !== "file:update") throw new Error("spherse:unsupported_event");
  if (!filter || typeof filter.path !== "string" || !filter.path.trim()) {
    throw new Error("spherse:invalid_event_filter");
  }
  if (typeof handler !== "function") throw new Error("spherse:invalid_event_handler");
  const path = resolveEventPath(filter.path, document.baseURI);
  if (!path) throw new Error("spherse:invalid_event_filter");

  const subscriptionId = genId();
  const subscription: Subscription = {
    event,
    filter: { path },
    handler,
  };
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

export function installEventListener(): void {
  window.addEventListener("message", (event: MessageEvent) => {
    const data = event.data as EventMessage | null;
    if (!data || data.type !== "spherse:event" || data.event !== "file:update") return;
    const subscription = subscriptions.get(data.subscriptionId);
    if (!subscription || subscription.event !== data.event) return;
    try {
      void Promise.resolve(subscription.handler(data.payload)).catch(() => undefined);
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
