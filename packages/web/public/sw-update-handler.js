self.addEventListener("message", (event) => {
  if (event.data?.type !== "SPHERSE_CLEAR_STATIC_CACHE") return;
  event.waitUntil(
    (async () => {
      const scope = self.registration.scope;
      const names = await caches.keys();
      await Promise.all(
        names
          .filter(
            (name) => name.startsWith("workbox-") && name.endsWith(scope),
          )
          .map((name) => caches.delete(name)),
      );
      await self.skipWaiting();
      if (event.ports && event.ports.length > 0) {
        event.ports[0].postMessage({ ok: true });
      }
    })(),
  );
});
