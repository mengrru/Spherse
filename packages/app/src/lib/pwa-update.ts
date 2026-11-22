const CLEAR_STATIC_CACHE_MESSAGE = "SPHERSE_CLEAR_STATIC_CACHE";
const ACK_TIMEOUT_MS = 3_000;

function requestStaticCacheClear(
  registration: ServiceWorkerRegistration,
): Promise<boolean> {
  const target =
    registration.waiting ??
    registration.active ??
    navigator.serviceWorker.controller;
  if (!target) return Promise.resolve(false);
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    const timer = setTimeout(() => resolve(false), ACK_TIMEOUT_MS);
    channel.port1.onmessage = () => {
      clearTimeout(timer);
      resolve(true);
    };
    target.postMessage({ type: CLEAR_STATIC_CACHE_MESSAGE }, [channel.port2]);
  });
}

export async function clearStaticCacheAndReload(): Promise<void> {
  if (!("serviceWorker" in navigator)) {
    window.location.reload();
    return;
  }
  try {
    const registration = await navigator.serviceWorker.getRegistration();
    if (registration) {
      await registration.update().catch(() => undefined);
      await requestStaticCacheClear(registration);
      await registration.unregister().catch(() => undefined);
    }
  } finally {
    window.location.reload();
  }
}
