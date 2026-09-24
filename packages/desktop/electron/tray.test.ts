import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";

const state = vi.hoisted(() => ({
  closeToTray: true,
  quitting: false,
  window: null as unknown,
  trays: [] as Array<{
    handlers: Map<string, () => void>;
    contextMenu: unknown;
    popped: unknown[];
    destroyed: boolean;
  }>,
}));

const appMock = vi.hoisted(() => ({
  isPackaged: false,
  quit: vi.fn(),
  focus: vi.fn(),
  dock: { show: vi.fn(async () => undefined), hide: vi.fn() },
}));

vi.mock("electron", () => {
  class MockTray {
    handlers = new Map<string, () => void>();
    contextMenu: unknown = null;
    popped: unknown[] = [];
    destroyed = false;
    constructor() {
      state.trays.push(this);
    }
    setToolTip() {}
    on(event: string, handler: () => void) {
      this.handlers.set(event, handler);
    }
    setContextMenu(menu: unknown) {
      this.contextMenu = menu;
    }
    popUpContextMenu(menu: unknown) {
      this.popped.push(menu);
    }
    isDestroyed() {
      return this.destroyed;
    }
    destroy() {
      this.destroyed = true;
    }
  }
  return {
    app: appMock,
    Tray: MockTray,
    Menu: { buildFromTemplate: (template: unknown) => ({ template }) },
    nativeImage: { createFromPath: (p: string) => ({ path: p, isEmpty: () => false }) },
  };
});

vi.mock("./settings.js", () => ({
  getCloseToTray: () => state.closeToTray,
  getLocale: () => "en",
}));
vi.mock("./lifecycle.js", () => ({
  isQuitting: () => state.quitting,
}));
vi.mock("./window.js", () => ({
  getMainWindow: () => state.window,
}));

import { attachCloseToTray, buildTrayMenuTemplate, destroyTray, showMainWindow, syncTray } from "./tray.js";

class FakeWindow extends EventEmitter {
  visible = true;
  minimized = false;
  fullScreen = false;
  destroyed = false;
  hide = vi.fn(() => {
    this.visible = false;
  });
  show = vi.fn(() => {
    this.visible = true;
  });
  focus = vi.fn();
  restore = vi.fn(() => {
    this.minimized = false;
  });
  setFullScreen = vi.fn((value: boolean) => {
    this.fullScreen = value;
  });
  isVisible() {
    return this.visible;
  }
  isMinimized() {
    return this.minimized;
  }
  isFullScreen() {
    return this.fullScreen;
  }
  isDestroyed() {
    return this.destroyed;
  }
}

const originalPlatform = process.platform;
function setPlatform(platform: NodeJS.Platform): void {
  Object.defineProperty(process, "platform", { value: platform });
}

function emitClose(win: FakeWindow): { prevented: boolean } {
  const event = { prevented: false, preventDefault() { this.prevented = true; } };
  win.emit("close", event);
  return event;
}

beforeEach(() => {
  state.closeToTray = true;
  state.quitting = false;
  state.window = null;
  state.trays.length = 0;
  vi.clearAllMocks();
  destroyTray();
});

afterEach(() => {
  setPlatform(originalPlatform);
});

describe("buildTrayMenuTemplate", () => {
  it("builds localized show and quit items wired to handlers", () => {
    const onShow = vi.fn();
    const onQuit = vi.fn();
    const template = buildTrayMenuTemplate("en", { onShow, onQuit });
    const items = template.filter((item) => item.type !== "separator");
    expect(items.map((item) => item.label)).toEqual(["Open Spherse", "Quit"]);
    (items[0].click as () => void)();
    (items[1].click as () => void)();
    expect(onShow).toHaveBeenCalledTimes(1);
    expect(onQuit).toHaveBeenCalledTimes(1);
  });
});

describe("syncTray", () => {
  it("creates a single tray when enabled and reuses it on repeated sync", () => {
    setPlatform("win32");
    syncTray();
    syncTray();
    expect(state.trays).toHaveLength(1);
    expect(state.trays[0].contextMenu).not.toBeNull();
  });

  it("destroys the tray when disabled", () => {
    setPlatform("win32");
    syncTray();
    state.closeToTray = false;
    syncTray();
    expect(state.trays[0].destroyed).toBe(true);
    state.closeToTray = true;
    syncTray();
    expect(state.trays).toHaveLength(2);
  });

  it("uses right-click popup instead of a context menu on macOS", () => {
    setPlatform("darwin");
    syncTray();
    const tray = state.trays[0];
    expect(tray.contextMenu).toBeNull();
    tray.handlers.get("right-click")?.();
    expect(tray.popped).toHaveLength(1);
  });

  it("uses the context menu on linux", () => {
    setPlatform("linux");
    syncTray();
    const tray = state.trays[0];
    expect(tray.contextMenu).not.toBeNull();
    expect(tray.handlers.has("right-click")).toBe(false);
  });

  it("shows the main window on tray click", async () => {
    setPlatform("win32");
    const win = new FakeWindow();
    win.visible = false;
    state.window = win;
    syncTray();
    state.trays[0].handlers.get("click")?.();
    await vi.waitFor(() => expect(win.show).toHaveBeenCalled());
    expect(win.focus).toHaveBeenCalled();
  });
});

describe("showMainWindow", () => {
  it("restores dock before showing on macOS", async () => {
    setPlatform("darwin");
    const win = new FakeWindow();
    win.visible = false;
    win.minimized = true;
    state.window = win;
    await showMainWindow();
    expect(appMock.dock.show).toHaveBeenCalled();
    expect(appMock.dock.show.mock.invocationCallOrder[0]).toBeLessThan(win.show.mock.invocationCallOrder[0]);
    expect(win.restore).toHaveBeenCalled();
    expect(appMock.focus).toHaveBeenCalledWith({ steal: true });
  });

  it("is a no-op while quitting or when window is destroyed", async () => {
    const win = new FakeWindow();
    state.window = win;
    state.quitting = true;
    await showMainWindow();
    state.quitting = false;
    win.destroyed = true;
    await showMainWindow();
    expect(win.show).not.toHaveBeenCalled();
  });
});

describe("attachCloseToTray", () => {
  it("hides instead of closing when enabled", () => {
    setPlatform("win32");
    const win = new FakeWindow();
    attachCloseToTray(win as never);
    expect(emitClose(win).prevented).toBe(true);
    expect(win.hide).toHaveBeenCalled();
    expect(appMock.quit).not.toHaveBeenCalled();
    expect(appMock.dock.hide).not.toHaveBeenCalled();
  });

  it("hides the dock on macOS", () => {
    setPlatform("darwin");
    const win = new FakeWindow();
    attachCloseToTray(win as never);
    emitClose(win);
    expect(appMock.dock.hide).toHaveBeenCalled();
  });

  it("exits fullscreen before hiding", () => {
    setPlatform("darwin");
    const win = new FakeWindow();
    win.fullScreen = true;
    attachCloseToTray(win as never);
    expect(emitClose(win).prevented).toBe(true);
    expect(win.setFullScreen).toHaveBeenCalledWith(false);
    expect(win.hide).not.toHaveBeenCalled();
    win.emit("leave-full-screen");
    expect(win.hide).toHaveBeenCalled();
  });

  it("allows close when disabled", () => {
    state.closeToTray = false;
    const win = new FakeWindow();
    attachCloseToTray(win as never);
    expect(emitClose(win).prevented).toBe(false);
    expect(win.hide).not.toHaveBeenCalled();
  });

  it("allows close while quitting", () => {
    state.quitting = true;
    const win = new FakeWindow();
    attachCloseToTray(win as never);
    expect(emitClose(win).prevented).toBe(false);
  });

  it("treats close on a window already hidden to tray as a quit request", () => {
    setPlatform("win32");
    const win = new FakeWindow();
    attachCloseToTray(win as never);
    emitClose(win);
    expect(appMock.quit).not.toHaveBeenCalled();
    expect(emitClose(win).prevented).toBe(true);
    expect(appMock.quit).toHaveBeenCalledTimes(1);
  });

  it("hides again after the window is shown", () => {
    setPlatform("win32");
    const win = new FakeWindow();
    attachCloseToTray(win as never);
    emitClose(win);
    win.emit("show");
    expect(emitClose(win).prevented).toBe(true);
    expect(appMock.quit).not.toHaveBeenCalled();
    expect(win.hide).toHaveBeenCalledTimes(2);
  });

  it("hides a minimized window instead of quitting", () => {
    setPlatform("win32");
    const win = new FakeWindow();
    win.minimized = true;
    attachCloseToTray(win as never);
    expect(emitClose(win).prevented).toBe(true);
    expect(appMock.quit).not.toHaveBeenCalled();
    expect(win.hide).toHaveBeenCalled();
  });
});
