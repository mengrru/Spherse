/// <reference lib="webworker" />
import { skipWaiting, clientsClaim } from "workbox-core";
import { precacheAndRoute, createHandlerBoundToURL } from "workbox-precaching";
import { registerRoute, NavigationRoute } from "workbox-routing";

declare let self: ServiceWorkerGlobalScope;

skipWaiting();
clientsClaim();

precacheAndRoute(self.__WB_MANIFEST);

registerRoute(
  new NavigationRoute(createHandlerBoundToURL("index.html"), {
    denylist: [/^\/api\//, /^\/ws\//, /^\/preview\//],
  }),
);

self.addEventListener("push", (event: PushEvent) => {
  if (!event.data) return;
  let payload: {
    title?: string;
    body?: string;
    tag?: string;
  };
  try {
    payload = event.data.json();
  } catch {
    return;
  }
  if (typeof payload.title !== "string" || typeof payload.body !== "string") return;
  const options: NotificationOptions = { body: payload.body };
  if (typeof payload.tag === "string" && payload.tag.length > 0) {
    options.tag = payload.tag;
  }
  event.waitUntil(self.registration.showNotification(payload.title, options));
});

self.addEventListener("notificationclick", (event: NotificationEvent) => {
  event.notification.close();
  event.waitUntil(
    (async () => {
      const clientList = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const client of clientList) {
        if ("focus" in client) return await client.focus();
      }
      return await self.clients.openWindow(self.registration.scope);
    })(),
  );
});
