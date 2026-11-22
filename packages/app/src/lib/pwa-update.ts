const CLEAR_STATIC_CACHE_MESSAGE = "SPHERSE_CLEAR_STATIC_CACHE";
const ACK_TIMEOUT_MS = 8_000;
const UPDATE_TIMEOUT_MS = 5_000;

async function withTimeout(promise: Promise<unknown>, ms: number): Promise<undefined> {
  await Promise.race([
    promise.catch(() => undefined),
    new Promise<undefined>((resolve) => {
      setTimeout(() => resolve(undefined), ms);
    }),
  ]);
}

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
  if (navigator.onLine === false) {
    window.location.reload();
    return;
  }
  try {
    const registration = await navigator.serviceWorker.getRegistration();
    if (registration) {
      await withTimeout(registration.update(), UPDATE_TIMEOUT_MS);
      await requestStaticCacheClear(registration);
      await registration.unregister().catch(() => undefined);
    }
  } catch {
    void 0;
  } finally {
    window.location.reload();
  }
}
