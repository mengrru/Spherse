import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearStaticCacheAndReload } from "./pwa-update";

type FakeServiceWorker = {
  postMessage: (data: unknown, transfer: MessagePort[]) => void;
};

type FakeRegistration = {
  waiting: FakeServiceWorker | null;
  active: FakeServiceWorker | null;
  update: ReturnType<typeof vi.fn>;
  unregister: ReturnType<typeof vi.fn>;
};

type ServiceWorkerStub = {
  getRegistration: ReturnType<typeof vi.fn>;
  controller: FakeServiceWorker | null;
};

function defineNavigatorServiceWorker(value: object | undefined) {
  Object.defineProperty(navigator, "serviceWorker", {
    value,
    configurable: true,
  });
}

function setNavigatorOnline(value: boolean) {
  Object.defineProperty(navigator, "onLine", {
    value,
    configurable: true,
  });
}

function stubServiceWorkerContainer(
  getRegistration: ServiceWorkerStub["getRegistration"],
  controller: FakeServiceWorker | null = null,
) {
  defineNavigatorServiceWorker({ getRegistration, controller });
}

function stubRegistration(
  overrides?: Partial<FakeRegistration> & { postMessageImpl?: (port: MessagePort) => void },
): FakeRegistration {
  const { postMessageImpl, ...rest } = overrides ?? {};
  const ack =
    postMessageImpl ?? ((port: MessagePort) => port.postMessage({ ok: true }));
  const sw: FakeServiceWorker = {
    postMessage: vi.fn((_data, transfer) => ack(transfer[0])),
  };
  const registration: FakeRegistration = {
    waiting: null,
    active: sw,
    update: vi.fn(async () => undefined),
    unregister: vi.fn(async () => true),
    ...rest,
  };
  stubServiceWorkerContainer(vi.fn(async () => registration));
  return registration;
}

let reload: ReturnType<typeof vi.fn>;
let originalLocation: Location;

beforeEach(() => {
  originalLocation = window.location;
  reload = vi.fn();
  Object.defineProperty(window, "location", {
    value: { ...originalLocation, reload },
    configurable: true,
    writable: true,
  });
  setNavigatorOnline(true);
});

afterEach(() => {
  Object.defineProperty(window, "location", {
    value: originalLocation,
    configurable: true,
    writable: true,
  });
  defineNavigatorServiceWorker(undefined);
  delete (navigator as { serviceWorker?: object }).serviceWorker;
  setNavigatorOnline(true);
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("clearStaticCacheAndReload", () => {
  it("reloads directly when service worker is unsupported", async () => {
    defineNavigatorServiceWorker(undefined);
    delete (navigator as { serviceWorker?: object }).serviceWorker;

    await clearStaticCacheAndReload();

    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("reloads without touching the registration when offline", async () => {
    const registration = stubRegistration();
    setNavigatorOnline(false);

    await clearStaticCacheAndReload();

    expect(registration.update).not.toHaveBeenCalled();
    expect(registration.unregister).not.toHaveBeenCalled();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("reloads directly when no registration exists", async () => {
    stubServiceWorkerContainer(vi.fn(async () => undefined));

    await clearStaticCacheAndReload();

    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("resolves with a plain reload when getRegistration rejects", async () => {
    stubServiceWorkerContainer(
      vi.fn(async () => {
        throw new Error("sw broken");
      }),
    );

    await expect(clearStaticCacheAndReload()).resolves.toBeUndefined();

    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("clears caches via the waiting worker, unregisters and reloads", async () => {
    const order: string[] = [];
    const registration = stubRegistration({
      postMessageImpl: (port) => {
        order.push("ack");
        port.postMessage({ ok: true });
      },
    });
    registration.update.mockImplementation(async () => {
      order.push("update");
    });
    registration.unregister.mockImplementation(async () => {
      order.push("unregister");
      return true;
    });
    registration.waiting = registration.active;
    registration.active = null;
    const waiting = registration.waiting as FakeServiceWorker;
    const postMessage = waiting.postMessage as ReturnType<typeof vi.fn>;

    await clearStaticCacheAndReload();

    expect(postMessage).toHaveBeenCalledTimes(1);
    expect(postMessage.mock.calls[0][0]).toEqual({
      type: "SPHERSE_CLEAR_STATIC_CACHE",
    });
    expect(order).toEqual(["update", "ack", "unregister"]);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("falls back to the controlling worker when no registration worker exists", async () => {
    const order: string[] = [];
    const registration = stubRegistration();
    registration.waiting = null;
    registration.active = null;
    registration.update.mockImplementation(async () => {
      order.push("update");
    });
    registration.unregister.mockImplementation(async () => {
      order.push("unregister");
      return true;
    });
    const controller = {
      postMessage: vi.fn((_data: unknown, transfer: MessagePort[]) => {
        order.push("controller-message");
        transfer[0].postMessage({ ok: true });
      }),
    };
    stubServiceWorkerContainer(
      vi.fn(async () => registration),
      controller,
    );

    await clearStaticCacheAndReload();

    expect(controller.postMessage).toHaveBeenCalledTimes(1);
    expect(order).toEqual(["update", "controller-message", "unregister"]);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("still unregisters and reloads when the worker never acknowledges", async () => {
    vi.useFakeTimers();
    const registration = stubRegistration({
      postMessageImpl: () => undefined,
    });

    const pending = clearStaticCacheAndReload();
    await vi.advanceTimersByTimeAsync(8_100);
    await pending;

    expect(registration.unregister).toHaveBeenCalledTimes(1);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("proceeds to unregister and reload when update() rejects", async () => {
    const registration = stubRegistration();
    registration.update.mockRejectedValue(new Error("offline"));

    await clearStaticCacheAndReload();

    expect(registration.unregister).toHaveBeenCalledTimes(1);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("skips waiting for an update check that never resolves", async () => {
    vi.useFakeTimers();
    const registration = stubRegistration();
    registration.update.mockImplementation(
      () => new Promise<void>(() => undefined),
    );

    const pending = clearStaticCacheAndReload();
    await vi.advanceTimersByTimeAsync(5_100);
    await pending;

    expect(registration.unregister).toHaveBeenCalledTimes(1);
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
