import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useUpdateChecker } from "./use-update-checker";
import { HostBridgeProvider } from "../../context/host-bridge-context";
import type { HostBridge, UpdateEvent, UpdateState } from "../../lib/host-bridge";

type UpdateEventListener = (event: UpdateEvent) => void;

let host: HTMLDivElement;
let root: Root | null = null;
let listeners: UpdateEventListener[] = [];
let latestState: UpdateState = { status: "idle" };
let getUpdateStateResult: UpdateState = { status: "idle" };
let checkedWith: { silent: boolean } | null = null;
let probeApi: ReturnType<typeof useUpdateChecker> | null = null;

function renderHook() {
  const bridge = {
    kind: "electron" as const,
    capabilities: {},
    getServerBaseUrl: async () => "http://localhost:5173",
    getSettings: async () => null,
    saveSettings: async () => ({ success: true }),
    openExternal: async () => {},
    updater: {
      getUpdateState: async () => getUpdateStateResult,
      checkForUpdates: async (opts: { silent: boolean }) => {
        checkedWith = opts;
      },
      onUpdateEvent: (callback: UpdateEventListener) => {
        listeners.push(callback);
        return () => {};
      },
    },
  } as unknown as HostBridge;
  const Probe = () => {
    probeApi = useUpdateChecker();
    latestState = probeApi.state;
    return null;
  };
  act(() => {
    root = createRoot(host);
    root.render(
      <HostBridgeProvider bridge={bridge}>
        <Probe />
      </HostBridgeProvider>,
    );
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

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  listeners = [];
  latestState = { status: "idle" };
  getUpdateStateResult = { status: "idle" };
  checkedWith = null;
  probeApi = null;
});

afterEach(() => {
  if (root) {
    act(() => root!.unmount());
    root = null;
  }
  host.remove();
});

describe("useUpdateChecker behavior", () => {
  it("stays idle on a silent update-available event (no dialog state)", async () => {
    renderHook();
    await flushMount();
    emit({
      type: "update-available",
      version: "0.2.0",
      releaseNotes: "",
      downloadUrl: "https://oss/x.dmg",
      silent: true,
    });
    expect(latestState).toEqual({ status: "idle" });
  });

  it("enters available on a manual update-available event", async () => {
    renderHook();
    await flushMount();
    emit({
      type: "update-available",
      version: "0.2.0",
      releaseNotes: "",
      downloadUrl: "https://oss/x.dmg",
      silent: false,
    });
    expect(latestState).toEqual({
      status: "available",
      version: "0.2.0",
      releaseNotes: "",
      downloadUrl: "https://oss/x.dmg",
    });
  });

  it("restores an upToDate host state as idle on mount (check button clickable again)", async () => {
    getUpdateStateResult = { status: "upToDate" };
    renderHook();
    await flushMount();
    expect(latestState).toEqual({ status: "idle" });
  });

  it("restores an in-flight downloading host state on mount", async () => {
    getUpdateStateResult = { status: "downloading", percent: 40 };
    renderHook();
    await flushMount();
    expect(latestState).toEqual({ status: "downloading", percent: 40 });
  });

  it("manual check issues a non-silent request and reflects checking", async () => {
    renderHook();
    await flushMount();
    await act(async () => {
      await probeApi!.check();
    });
    expect(checkedWith).toEqual({ silent: false });
    expect(latestState).toEqual({ status: "checking" });
  });
});
