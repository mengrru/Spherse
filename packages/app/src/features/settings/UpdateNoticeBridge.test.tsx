import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "@spherse/i18n/react";
import { UpdateNoticeBridge } from "./UpdateNoticeBridge";
import { HostBridgeProvider } from "../../context/host-bridge-context";
import type { HostBridge, UpdateEvent } from "../../lib/host-bridge";

type UpdateEventListener = (event: UpdateEvent) => void;

let host: HTMLDivElement;
let root: Root | null = null;
let listeners: UpdateEventListener[] = [];
let openExternal: ReturnType<typeof vi.fn>;

function createBridge(withUpdater: boolean): HostBridge {
  const bridge = {
    kind: "electron" as const,
    capabilities: {},
    getServerBaseUrl: async () => "http://localhost:5173",
    getSettings: async () => null,
    saveSettings: async () => ({ success: true }),
    openExternal,
  };
  if (withUpdater) {
    return {
      ...bridge,
      updater: {
        onUpdateEvent: (callback: UpdateEventListener) => {
          listeners.push(callback);
          return () => {};
        },
      },
    } as unknown as HostBridge;
  }
  return bridge as unknown as HostBridge;
}

function renderBridge(bridge: HostBridge) {
  const Probe = () => (
    <I18nProvider locale="zh-CN">
      <HostBridgeProvider bridge={bridge}>
        <UpdateNoticeBridge />
      </HostBridgeProvider>
    </I18nProvider>
  );
  act(() => {
    root = createRoot(host);
    root.render(<Probe />);
  });
}

function emit(event: UpdateEvent) {
  act(() => {
    for (const listener of listeners) listener(event);
  });
}

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  listeners = [];
  openExternal = vi.fn();
});

afterEach(() => {
  if (root) {
    act(() => root!.unmount());
    root = null;
  }
  host.remove();
  vi.restoreAllMocks();
});

describe("UpdateNoticeBridge", () => {
  it("toasts a silent update-available event with a go-update action opening the download url", async () => {
    renderBridge(createBridge(true));
    const toastMock = await import("sonner").then((m) => vi.spyOn(m.toast, "success"));

    emit({
      type: "update-available",
      version: "0.2.0",
      releaseNotes: "",
      downloadUrl: "https://oss/spherse/releases/0.2.0/Spherse-0.2.0-arm64.dmg",
      silent: true,
    });

    expect(toastMock).toHaveBeenCalledTimes(1);
    const [title, options] = toastMock.mock.calls[0];
    expect(title).toContain("0.2.0");
    expect(options?.duration).toBeGreaterThan(0);
    expect(options?.action?.label).toEqual("去更新");
    options?.action?.onClick();
    expect(openExternal).toHaveBeenCalledWith(
      "https://oss/spherse/releases/0.2.0/Spherse-0.2.0-arm64.dmg",
    );
  });

  it("falls back to the website when the manifest has no platform download url", async () => {
    renderBridge(createBridge(true));
    const toastMock = await import("sonner").then((m) => vi.spyOn(m.toast, "success"));

    emit({ type: "update-available", version: "0.2.0", releaseNotes: "", silent: true });

    expect(toastMock).toHaveBeenCalledTimes(1);
    toastMock.mock.calls[0][1]?.action?.onClick();
    expect(openExternal).toHaveBeenCalledWith("https://spherse.mengru.work/");
  });

  it("ignores manual update-available events and non-available events", async () => {
    renderBridge(createBridge(true));
    const toastMock = await import("sonner").then((m) => vi.spyOn(m.toast, "success"));

    emit({
      type: "update-available",
      version: "0.2.0",
      releaseNotes: "",
      downloadUrl: "https://oss/x.dmg",
      silent: false,
    });
    emit({ type: "update-not-available" });
    emit({ type: "update-error", message: "boom" });

    expect(toastMock).not.toHaveBeenCalled();
    expect(openExternal).not.toHaveBeenCalled();
  });

  it("renders nothing without an updater api (web host)", () => {
    renderBridge(createBridge(false));
    expect(host.childElementCount).toBe(0);
  });
});
