import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
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

function renderUpdateChecker() {
  const bridge = createMockHostBridge({
    updater: {
      getUpdateState: async () => getUpdateStateResult,
      checkForUpdates: async (opts: { silent: boolean }) => {
        checkedWith = opts;
      },
      onUpdateEvent: (callback: UpdateEventListener) => {
        listeners.push(callback);
        return () => {};
      },
    } as never,
  }) as unknown as HostBridge;
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
    await act(async () => {
      await result.current.check();
    });
    expect(checkedWith).toEqual({ silent: false });
    expect(result.current.state).toEqual({ status: "checking" });
  });
});
