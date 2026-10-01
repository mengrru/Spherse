import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { handlers, app, stopTunnel, stopServer } = vi.hoisted(() => {
  const handlers = new Map<string, (event: { preventDefault(): void }) => void>();
  return {
    handlers,
    app: { on: vi.fn((name, listener) => handlers.set(name, listener)), whenReady: () => new Promise(() => {}), quit: vi.fn(), relaunch: vi.fn(), exit: vi.fn() },
    stopTunnel: vi.fn(),
    stopServer: vi.fn(),
  };
});

vi.mock("electron", () => ({ app }));
vi.mock("./window.js", () => ({ createWindow: vi.fn(), getMainWindow: vi.fn() }));
vi.mock("./settings.js", () => ({ restoreEnvFromSettings: vi.fn(), getMobileAccess: vi.fn() }));
vi.mock("./fix-path.js", () => ({ fixPath: vi.fn() }));
vi.mock("./server.js", () => ({ ensureServer: vi.fn(), stopServer, getServerPort: vi.fn() }));
vi.mock("./ipc/index.js", () => ({ registerAllIpc: vi.fn() }));
vi.mock("./updater.js", () => ({ startAutoUpdateChecks: vi.fn() }));
vi.mock("./ipc/context-menu.js", () => ({ setupContextMenu: vi.fn() }));
vi.mock("./tunnel/manager.js", () => ({ getTunnelManager: () => ({ stop: stopTunnel }) }));
vi.mock("./tray.js", () => ({ attachCloseToTray: vi.fn(), destroyTray: vi.fn(), showMainWindow: vi.fn(), syncTray: vi.fn() }));

describe("main shutdown wiring", () => {
  beforeEach(() => { vi.resetModules(); vi.clearAllMocks(); vi.useFakeTimers(); });
  afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); });

  it("blocks repeated before-quit events through tunnel and server cleanup before handing off installation", async () => {
    vi.useFakeTimers();
    let tunnelDone!: () => void;
    let serverDone!: () => void;
    stopTunnel.mockReturnValue(new Promise<void>((resolve) => { tunnelDone = resolve; }));
    stopServer.mockReturnValue(new Promise<void>((resolve) => { serverDone = resolve; }));
    await import("./main.js");
    const { shutdown } = await import("./lifecycle.js");
    const handoff = vi.fn();
    const task = shutdown!.install(handoff, vi.fn());
    const event = { preventDefault: vi.fn() };
    handlers.get("before-quit")!(event);
    handlers.get("before-quit")!(event);
    await vi.advanceTimersByTimeAsync(0);
    expect(event.preventDefault).toHaveBeenCalledTimes(2);
    expect(stopTunnel).toHaveBeenCalledTimes(1);
    expect(stopServer).not.toHaveBeenCalled();
    tunnelDone();
    await vi.advanceTimersByTimeAsync(0);
    expect(stopServer).toHaveBeenCalledTimes(1);
    handlers.get("before-quit")!(event);
    expect(event.preventDefault).toHaveBeenCalledTimes(3);
    expect(handoff).not.toHaveBeenCalled();
    serverDone();
    await task;
    expect(handoff).toHaveBeenCalledTimes(1);
    expect(app.quit).not.toHaveBeenCalled();
    handlers.get("before-quit")!(event);
    expect(event.preventDefault).toHaveBeenCalledTimes(3);
  });

  it.each(["tunnel-error", "tunnel-timeout", "server-error"])("drains what it can and recovers without installation on %s", async (failure) => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    stopTunnel.mockImplementation(() => {
      if (failure === "tunnel-error") throw new Error("tunnel");
      if (failure === "tunnel-timeout") return new Promise(() => {});
      return Promise.resolve();
    });
    stopServer.mockImplementation(async () => { if (failure === "server-error") throw new Error("server"); });
    await import("./main.js");
    const { shutdown } = await import("./lifecycle.js");
    const handoff = vi.fn();
    const onFailure = vi.fn();
    const task = shutdown!.install(handoff, onFailure);
    await vi.advanceTimersByTimeAsync(5_000);
    await task;
    expect(stopServer).toHaveBeenCalledTimes(1);
    expect(handoff).not.toHaveBeenCalled();
    expect(onFailure).toHaveBeenCalledTimes(1);
    expect(app.relaunch).toHaveBeenCalledTimes(1);
    expect(app.quit).toHaveBeenCalledTimes(1);
    expect(shutdown!.canExit()).toBe(true);
  });
});
