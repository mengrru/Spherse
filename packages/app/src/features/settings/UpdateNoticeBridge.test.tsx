import { act, render } from "@testing-library/react";
import { I18nProvider } from "@spherse/i18n/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UpdateNoticeBridge } from "./UpdateNoticeBridge";
import { HostBridgeProvider } from "../../context/host-bridge-context";
import type { HostBridge, UpdateEvent } from "../../lib/host-bridge";
import { DOWNLOAD_PAGE_URL } from "../../lib/urls";
import { createMockHostBridge } from "../../test/host-bridge";

type UpdateEventListener = (event: UpdateEvent) => void;

type ToastSuccessCall = [
  string,
  { duration?: number; action?: { label: string; onClick: () => void } },
];

function lastToastCall(mock: { mock: { calls: unknown[][] } }): ToastSuccessCall {
  const calls = mock.mock.calls as unknown as ToastSuccessCall[];
  return calls[calls.length - 1];
}

let listeners: UpdateEventListener[] = [];
let openExternal: ReturnType<typeof vi.fn>;

function createBridge(withUpdater: boolean): HostBridge {
  const bridge = createMockHostBridge({ openExternal: openExternal as never });
  if (!withUpdater) return bridge;
  return {
    ...bridge,
    updater: {
      onUpdateEvent: (callback: UpdateEventListener) => {
        listeners.push(callback);
        return () => {};
      },
    } as never,
  };
}

function renderBridge(bridge: HostBridge) {
  return render(
    <I18nProvider locale="zh-CN">
      <HostBridgeProvider bridge={bridge}>
        <UpdateNoticeBridge />
      </HostBridgeProvider>
    </I18nProvider>,
  );
}

function emit(event: UpdateEvent) {
  act(() => {
    for (const listener of listeners) listener(event);
  });
}

beforeEach(() => {
  listeners = [];
  openExternal = vi.fn(async () => {});
});

afterEach(() => {
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
    const [title, options] = lastToastCall(toastMock);
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
    lastToastCall(toastMock)[1]?.action?.onClick();
    expect(openExternal).toHaveBeenCalledWith(DOWNLOAD_PAGE_URL);
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
    const { container } = renderBridge(createBridge(false));
    expect(container.childElementCount).toBe(0);
  });
});
