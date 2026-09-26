import { describe, expect, it, vi, beforeEach } from "vitest";

const handlers = new Map<string, (...args: unknown[]) => unknown>();

const { NotificationCtor, ctorSpy, notificationInstances } = vi.hoisted(() => {
  const instances: Array<{ options: unknown; show: ReturnType<typeof vi.fn>; on: ReturnType<typeof vi.fn> }> = [];
  const ctorSpy = vi.fn();
  class NotificationCtor {
    options: unknown;
    show = vi.fn();
    on = vi.fn();
    constructor(options: unknown) {
      ctorSpy(options);
      this.options = options;
      instances.push(this as never);
    }
    static isSupported = vi.fn(() => true);
  }
  return { NotificationCtor, ctorSpy, notificationInstances: instances };
});

vi.mock("electron", () => ({
  ipcMain: {
    handle: (channel: string, handler: (...args: unknown[]) => unknown) => {
      handlers.set(channel, handler);
    },
  },
  Notification: NotificationCtor,
}));

const { showMainWindowMock } = vi.hoisted(() => ({ showMainWindowMock: vi.fn() }));

vi.mock("../tray.js", () => ({
  showMainWindow: showMainWindowMock,
}));

import { registerNotificationsIpc } from "./notifications.js";

describe("notifications:show ipc", () => {
  beforeEach(() => {
    handlers.clear();
    ctorSpy.mockClear();
    notificationInstances.length = 0;
    NotificationCtor.isSupported.mockClear();
    NotificationCtor.isSupported.mockImplementation(() => true);
    registerNotificationsIpc();
  });

  it("shows a notification for a valid request", () => {
    handlers.get("notifications:show")!(null, { title: "T", body: "B" });
    expect(ctorSpy).toHaveBeenCalledWith({ title: "T", body: "B" });
    expect(notificationInstances[0].show).toHaveBeenCalled();
  });

  it("is silent when notifications are unsupported", () => {
    NotificationCtor.isSupported.mockImplementationOnce(() => false);
    handlers.get("notifications:show")!(null, { title: "T", body: "B" });
    expect(ctorSpy).not.toHaveBeenCalled();
  });

  it("ignores malformed requests", () => {
    handlers.get("notifications:show")!(null, { title: 1 });
    handlers.get("notifications:show")!(null, undefined);
    expect(ctorSpy).not.toHaveBeenCalled();
  });
});
