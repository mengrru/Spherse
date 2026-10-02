import { beforeEach, describe, expect, it, vi } from "vitest";

const { appMock, builtinAutoUpdaterMock, tunnelStopMock, stopServerMock, destroyTrayMock } =
  vi.hoisted(() => {
    const createEmitter = () => {
      const listeners = new Map<string, Array<(payload?: unknown) => void>>();
      return {
        on(event: string, listener: (payload?: unknown) => void) {
          const list = listeners.get(event) ?? [];
          list.push(listener);
          listeners.set(event, list);
        },
        emit(event: string, payload?: unknown) {
          for (const listener of [...(listeners.get(event) ?? [])]) listener(payload);
        },
        removeAllListeners() {
          listeners.clear();
        },
      };
    };
    const appMock = Object.assign(createEmitter(), {
      exit: vi.fn(),
      quit: vi.fn(),
    });
    const builtinAutoUpdaterMock = createEmitter();
    const tunnelStopMock = vi.fn(async () => {});
    const stopServerMock = vi.fn(async () => {});
    const destroyTrayMock = vi.fn();
    return { appMock, builtinAutoUpdaterMock, tunnelStopMock, stopServerMock, destroyTrayMock };
  });

vi.mock("electron", () => ({
  app: appMock,
  autoUpdater: builtinAutoUpdaterMock,
}));
vi.mock("./tunnel/manager.js", () => ({
  getTunnelManager: () => ({ stop: tunnelStopMock }),
}));
vi.mock("./server.js", () => ({
  ensureServer: vi.fn(async () => {}),
  stopServer: stopServerMock,
  getServerPort: vi.fn(() => 0),
}));
vi.mock("./tray.js", () => ({
  attachCloseToTray: vi.fn(),
  destroyTray: destroyTrayMock,
  showMainWindow: vi.fn(),
  syncTray: vi.fn(),
}));

let registerQuitHandlers: () => void;

beforeEach(async () => {
  vi.resetModules();
  appMock.removeAllListeners();
  builtinAutoUpdaterMock.removeAllListeners();
  appMock.exit.mockClear();
  appMock.quit.mockClear();
  tunnelStopMock.mockClear();
  stopServerMock.mockClear();
  destroyTrayMock.mockClear();
  ({ registerQuitHandlers } = await import("./quit-handlers.js"));
  registerQuitHandlers();
});

function emitAppQuit(): { preventDefault: ReturnType<typeof vi.fn> } {
  const event = { preventDefault: vi.fn() };
  appMock.emit("before-quit", event);
  return event;
}

describe("quit handlers: 常规退出走优雅关闭", () => {
  it("before-quit 阻断默认退出并串行走 tunnel stop → stopServer → quit", async () => {
    emitAppQuit();
    await vi.waitFor(() => expect(appMock.quit).toHaveBeenCalledTimes(1));
    expect(tunnelStopMock).toHaveBeenCalledTimes(1);
    expect(stopServerMock).toHaveBeenCalledTimes(1);
    expect(appMock.exit).not.toHaveBeenCalled();
  });

  it("window-all-closed 同样触发优雅关闭", async () => {
    appMock.emit("window-all-closed");
    await vi.waitFor(() => expect(appMock.quit).toHaveBeenCalledTimes(1));
    expect(stopServerMock).toHaveBeenCalledTimes(1);
  });
});

describe("quit handlers: 更新安装退走快路径", () => {
  it("before-quit-for-update（electron-updater 对内置 autoUpdater emit）触发快路径：跳过 server 优雅关闭、销毁托盘、app.exit(0) 收尾", async () => {
    builtinAutoUpdaterMock.emit("before-quit-for-update");
    await vi.waitFor(() => expect(appMock.exit).toHaveBeenCalledWith(0));

    expect(tunnelStopMock).toHaveBeenCalledTimes(1);
    expect(stopServerMock).not.toHaveBeenCalled();
    expect(destroyTrayMock).toHaveBeenCalledTimes(1);
    expect(appMock.quit).not.toHaveBeenCalled();
  });

  it("快路径期间 before-quit 一律阻断（由 app.exit 收尾，不被常规优雅退出接管）", async () => {
    builtinAutoUpdaterMock.emit("before-quit-for-update");
    const event = emitAppQuit();
    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(stopServerMock).not.toHaveBeenCalled();

    await vi.waitFor(() => expect(appMock.exit).toHaveBeenCalledWith(0));
    expect(appMock.quit).not.toHaveBeenCalled();
  });

  it("重复的 before-quit-for-update 只触发一次快路径", async () => {
    builtinAutoUpdaterMock.emit("before-quit-for-update");
    builtinAutoUpdaterMock.emit("before-quit-for-update");
    await vi.waitFor(() => expect(appMock.exit).toHaveBeenCalledWith(0));
    expect(tunnelStopMock).toHaveBeenCalledTimes(1);
    expect(appMock.exit).toHaveBeenCalledTimes(1);
  });
});
