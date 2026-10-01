import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useUpdateChecker } from "./use-update-checker";
import { HostBridgeProvider } from "../../context/host-bridge-context";
import type { HostBridge, UpdateEvent, UpdateState } from "../../lib/host-bridge";
import { createMockHostBridge } from "../../test/host-bridge";

type UpdateEventListener = (event: UpdateEvent) => void;

let listeners: UpdateEventListener[] = [];
let getUpdateStateResult: UpdateState = { status: "idle" };
let checkedWith: { silent: boolean } | null = null;

beforeEach(() => {
  listeners = [];
  getUpdateStateResult = { status: "idle" };
  checkedWith = null;
});

function renderUpdateChecker(overrides: Partial<NonNullable<HostBridge["updater"]>> = {}) {
  const bridge = createMockHostBridge({
    updater: {
      getAppVersion: async () => "1.0.0",
      downloadUpdate: vi.fn(async () => {}),
      cancelUpdate: vi.fn(async () => {}),
      installUpdate: vi.fn(async () => {}),
      getUpdateState: async () => getUpdateStateResult,
      checkForUpdates: async (opts: { silent: boolean }) => {
        checkedWith = opts;
      },
      onUpdateEvent: (callback: UpdateEventListener) => {
        listeners.push(callback);
        return () => { listeners = listeners.filter((listener) => listener !== callback); };
      },
      ...overrides,
    },
  });
  return renderHook(() => useUpdateChecker(), {
    wrapper: ({ children }) => <HostBridgeProvider bridge={bridge}>{children}</HostBridgeProvider>,
  });
}

function emit(event: UpdateEvent) {
  act(() => {
    for (const listener of listeners) listener(event);
  });
}

async function flushMount() {
  await act(async () => {});
}

describe("useUpdateChecker behavior", () => {
  it("stays idle on a silent update-available event (no dialog state)", async () => {
    const { result } = renderUpdateChecker();
    await flushMount();
    emit({
      type: "update-available",
      version: "0.2.0",
      releaseNotes: "",
      downloadUrl: "https://oss/x.dmg",
      silent: true,
    });
    expect(result.current.state).toEqual({ status: "idle" });
  });

  it("enters available on a manual update-available event", async () => {
    const { result } = renderUpdateChecker();
    await flushMount();
    emit({
      type: "update-available",
      version: "0.2.0",
      releaseNotes: "",
      downloadUrl: "https://oss/x.dmg",
      silent: false,
    });
    expect(result.current.state).toEqual({
      status: "available",
      version: "0.2.0",
      releaseNotes: "",
      downloadUrl: "https://oss/x.dmg",
    });
  });

  it("restores an upToDate host state as idle on mount (check button clickable again)", async () => {
    getUpdateStateResult = { status: "upToDate" };
    const { result } = renderUpdateChecker();
    await flushMount();
    expect(result.current.state).toEqual({ status: "idle" });
  });

  it("restores an in-flight downloading host state on mount", async () => {
    getUpdateStateResult = { status: "downloading", percent: 40 };
    const { result } = renderUpdateChecker();
    await flushMount();
    expect(result.current.state).toEqual({ status: "downloading", percent: 40 });
  });

  it("manual check issues a non-silent request and reflects checking", async () => {
    const { result } = renderUpdateChecker();
    await flushMount();
    getUpdateStateResult = { status: "checking" };
    await act(async () => {
      await result.current.check();
    });
    expect(checkedWith).toEqual({ silent: false });
    expect(result.current.state).toEqual({ status: "checking" });
  });

  it("allows another manual Windows check after an up-to-date result and remount", async () => {
    getUpdateStateResult = { status: "idle", updateMode: "inApp" };
    const checkForUpdates = vi.fn(async () => {
      getUpdateStateResult = { status: "upToDate", updateMode: "inApp" };
      emit({ type: "update-state", state: getUpdateStateResult });
    });
    const first = renderUpdateChecker({ checkForUpdates });
    await flushMount();
    await act(() => first.result.current.check());
    expect(first.result.current.state.status).toBe("upToDate");
    first.unmount();
    const second = renderUpdateChecker({ checkForUpdates });
    await flushMount();
    expect(second.result.current.state).toEqual({ status: "idle", updateMode: "inApp" });
    await act(() => second.result.current.check());
    expect(checkForUpdates).toHaveBeenCalledTimes(2);
    expect(second.result.current.state.status).toBe("upToDate");
  });

  it("reconciles a no-op check while the initial downloaded snapshot is delayed", async () => {
    let resolveInitial!: (state: UpdateState) => void;
    const downloaded: UpdateState = { status: "downloaded", updateMode: "inApp", version: "2.0.0" };
    const getUpdateState = vi.fn<() => Promise<UpdateState>>()
      .mockImplementationOnce(() => new Promise((resolve) => { resolveInitial = resolve; }))
      .mockResolvedValue(downloaded);
    const checkForUpdates = vi.fn(async () => {});
    const { result } = renderUpdateChecker({ getUpdateState, checkForUpdates });
    await act(() => result.current.check());
    expect(checkForUpdates).toHaveBeenCalledWith({ silent: false });
    expect(getUpdateState).toHaveBeenCalledTimes(2);
    expect(result.current.state).toEqual(downloaded);
    await act(async () => resolveInitial(downloaded));
    expect(result.current.state).toEqual(downloaded);
  });

  it("does not let a delayed check reconciliation overwrite a newer state event", async () => {
    let resolve!: (state: UpdateState) => void;
    const getUpdateState = vi.fn<() => Promise<UpdateState>>()
      .mockResolvedValueOnce({ status: "idle", updateMode: "inApp" })
      .mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
    const { result } = renderUpdateChecker({ getUpdateState });
    await flushMount();
    let command!: Promise<void>;
    await act(async () => { command = result.current.check(); });
    const installing: UpdateState = { status: "installing", updateMode: "inApp" };
    emit({ type: "update-state", state: installing });
    await act(async () => { resolve({ status: "downloaded", updateMode: "inApp" }); await command; });
    expect(result.current.state).toEqual(installing);
  });

  it("ignores delayed initial and reconciliation snapshots after unmount", async () => {
    const resolvers: Array<(state: UpdateState) => void> = [];
    const getUpdateState = vi.fn(() => new Promise<UpdateState>((resolve) => { resolvers.push(resolve); }));
    const { result, unmount } = renderUpdateChecker({ getUpdateState });
    let command!: Promise<void>;
    await act(async () => { command = result.current.check(); });
    expect(getUpdateState).toHaveBeenCalledTimes(2);
    unmount();
    await act(async () => {
      for (const resolve of resolvers) resolve({ status: "downloaded", updateMode: "inApp" });
      await command;
    });
    expect(listeners).toHaveLength(0);
    expect(result.current.state.status).toBe("checking");
  });

  it("does not request reconciliation when a no-op check finishes after unmount", async () => {
    let resolve!: () => void;
    const getUpdateState = vi.fn(async (): Promise<UpdateState> => ({ status: "idle" }));
    const { result, unmount } = renderUpdateChecker({
      getUpdateState,
      checkForUpdates: () => new Promise((done) => { resolve = done; }),
    });
    await flushMount();
    let command!: Promise<void>;
    act(() => { command = result.current.check(); });
    unmount();
    await act(async () => { resolve(); await command; });
    expect(getUpdateState).toHaveBeenCalledOnce();
  });

  it("uses Windows state events rather than discovery notifications", async () => {
    const { result } = renderUpdateChecker();
    await flushMount();
    const state: UpdateState = { status: "downloading", percent: 42, updateMode: "inApp", version: "2.0.0" };
    emit({ type: "update-state", state });
    emit({ type: "update-available", version: "2.0.0", releaseNotes: "", updateMode: "inApp", silent: false });
    expect(result.current.state).toEqual(state);
    emit({ type: "update-state", state: { ...state, status: "downloaded" } });
    act(() => result.current.dismissRestart());
    expect(result.current.state.status).toBe("downloaded");
  });

  it.each(["available", "downloading", "downloaded", "installing", "error"] as const)("restores Windows %s on remount", async (status) => {
    getUpdateStateResult = { status, updateMode: "inApp", version: "2.0.0", errorPhase: "download" };
    const first = renderUpdateChecker();
    await flushMount();
    first.unmount();
    const second = renderUpdateChecker();
    await flushMount();
    expect(second.result.current.state).toEqual(getUpdateStateResult);
  });

  it("subscribes before reading and ignores a snapshot older than a state event", async () => {
    let resolve!: (state: UpdateState) => void;
    const { result } = renderUpdateChecker({ getUpdateState: () => {
      expect(listeners).toHaveLength(1);
      return new Promise((done) => { resolve = done; });
    } });
    const state: UpdateState = { status: "downloaded", updateMode: "inApp" };
    emit({ type: "update-state", state });
    await act(async () => resolve({ status: "available", updateMode: "inApp" }));
    expect(result.current.state).toEqual(state);
  });

  it("ignores late snapshots and commands after unmount and unsubscribes", async () => {
    let reject!: (error: Error) => void;
    let resolve!: (state: UpdateState) => void;
    const { result, unmount } = renderUpdateChecker({
      getUpdateState: () => new Promise((done) => { resolve = done; }),
      checkForUpdates: () => new Promise((_, fail) => { reject = fail; }),
    });
    let command!: Promise<void>;
    act(() => { command = result.current.check(); });
    unmount();
    await act(async () => {
      resolve({ status: "downloaded", updateMode: "inApp" });
      reject(new Error("disconnected"));
      await command;
    });
    expect(listeners).toHaveLength(0);
    expect(result.current.state.status).toBe("checking");
  });

  it("keeps Windows download and cancellation state authoritative and permits retry", async () => {
    getUpdateStateResult = { status: "available", updateMode: "inApp", version: "2.0.0" };
    const downloadUpdate = vi.fn(async () => {});
    const cancelUpdate = vi.fn(async () => {});
    const { result } = renderUpdateChecker({ downloadUpdate, cancelUpdate });
    await flushMount();
    await act(() => result.current.acceptDownload());
    expect(downloadUpdate).toHaveBeenCalledOnce();
    expect(result.current.state.status).toBe("available");
    emit({ type: "update-state", state: { ...getUpdateStateResult, status: "downloading", percent: 10 } });
    await act(() => result.current.cancelDownload());
    expect(cancelUpdate).toHaveBeenCalledOnce();
    expect(result.current.state.status).toBe("downloading");
    emit({ type: "update-state", state: getUpdateStateResult });
    await act(() => result.current.acceptDownload());
    expect(downloadUpdate).toHaveBeenCalledTimes(2);
  });

  it.each([
    ["check", "checkForUpdates", "check"],
    ["acceptDownload", "downloadUpdate", "download"],
    ["cancelDownload", "cancelUpdate", "download"],
    ["acceptRestart", "installUpdate", "install"],
  ] as const)("handles %s IPC rejection with the right phase", async (action, method, phase) => {
    getUpdateStateResult = { status: "available", updateMode: "inApp", version: "2.0.0" };
    const { result } = renderUpdateChecker({ [method]: vi.fn().mockRejectedValue(new Error("IPC unavailable")) });
    await flushMount();
    await act(() => result.current[action]());
    expect(result.current.state).toMatchObject({ status: "error", updateMode: "inApp", errorPhase: phase });
  });

  it("does not overwrite newer host state with a rejected command", async () => {
    let reject!: (error: Error) => void;
    const { result } = renderUpdateChecker({ downloadUpdate: () => new Promise((_, fail) => { reject = fail; }) });
    await flushMount();
    let command!: Promise<void>;
    act(() => { command = result.current.acceptDownload(); });
    const state: UpdateState = { status: "downloaded", updateMode: "inApp" };
    emit({ type: "update-state", state });
    await act(async () => { reject(new Error("late")); await command; });
    expect(result.current.state).toEqual(state);
  });

  it("retains installation and cancellation actions after IPC failures", async () => {
    getUpdateStateResult = { status: "downloaded", updateMode: "inApp", version: "2.0.0" };
    const { result } = renderUpdateChecker({
      installUpdate: vi.fn().mockRejectedValue(new Error("IPC unavailable")),
      cancelUpdate: vi.fn().mockRejectedValue(new Error("IPC unavailable")),
    });
    await flushMount();
    await act(() => result.current.acceptRestart());
    expect(result.current.state).toMatchObject({ status: "downloaded", errorPhase: "install", version: "2.0.0" });
    emit({ type: "update-state", state: { status: "downloading", updateMode: "inApp", percent: 42 } });
    await act(() => result.current.cancelDownload());
    expect(result.current.state).toMatchObject({ status: "downloading", errorPhase: "download", percent: 42 });
  });

  it("handles snapshot failure and runs without an updater", async () => {
    const mounted = renderUpdateChecker({ getUpdateState: vi.fn().mockRejectedValue(new Error("IPC unavailable")) });
    await flushMount();
    expect(mounted.result.current.state).toMatchObject({ status: "error", errorPhase: "check" });
    mounted.unmount();
    const bridge = createMockHostBridge();
    const { result } = renderHook(() => useUpdateChecker(), {
      wrapper: ({ children }) => <HostBridgeProvider bridge={bridge}>{children}</HostBridgeProvider>,
    });
    await act(() => result.current.check());
    expect(result.current.state).toEqual({ status: "idle" });
  });
});
