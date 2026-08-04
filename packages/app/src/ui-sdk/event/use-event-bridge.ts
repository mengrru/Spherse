import { useEffect, useRef } from "react";
import type { ApiClient } from "../../lib/api";
import { useBusSubscription } from "../../hooks/useBusSubscription";
import { isAllowedOrigin } from "../use-spherse-message-listener";
import { FileUpdateDebouncer, parseFileUpdate } from "./file-update";
import { EventSubscriptionRegistry } from "./subscription-registry";
import type { EventControlMessage, EventSourceWindow } from "./types";

function isEventSourceWindow(source: MessageEventSource | null): source is WindowProxy {
  return !!source && "postMessage" in source;
}

export function useEventBridge(
  projectId: string,
  client: ApiClient | null,
): void {
  const registryRef = useRef(new EventSubscriptionRegistry());
  const debouncerRef = useRef(new FileUpdateDebouncer());

  useBusSubscription(projectId, "fs-watch", (type, payload) => {
    if (type !== "change") return;
    const event = parseFileUpdate(payload);
    if (!event) return;
    debouncerRef.current.schedule(event, (nextEvent) => {
      registryRef.current.dispatchFileUpdate(nextEvent);
    });
  });

  useEffect(() => {
    if (!client) return;
    const registry = registryRef.current;
    const rendererOrigin = window.location.origin;
    const serverOrigin = client.baseUrl ?? null;

    const handler = (message: MessageEvent) => {
      const data = message.data as EventControlMessage | null;
      if (
        !data
        || (data.type !== "spherse:event-subscribe"
          && data.type !== "spherse:event-unsubscribe")
        || typeof data.subscriptionId !== "string"
        || !isAllowedOrigin(message.origin, rendererOrigin, serverOrigin)
        || !isEventSourceWindow(message.source)
      ) {
        return;
      }

      const source = message.source as EventSourceWindow;
      if (data.type === "spherse:event-unsubscribe") {
        registry.unsubscribe(source, data.subscriptionId);
        return;
      }
      if (typeof data.event !== "string") return;
      registry.subscribe(source, data.subscriptionId, data.event, data.filter);
    };

    window.addEventListener("message", handler);
    return () => {
      window.removeEventListener("message", handler);
      registry.clear();
    };
  }, [client]);

  useEffect(() => {
    const debouncer = debouncerRef.current;
    return () => debouncer.clear();
  }, []);
}
