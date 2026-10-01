import { act, cleanup, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UpdateNoticeBridge } from "./UpdateNoticeBridge";
import { UpdateChecker } from "./UpdateChecker";
import type { HostBridge, UpdateEvent, UpdateState } from "../../lib/host-bridge";
import { DOWNLOAD_PAGE_URL } from "../../lib/urls";
import { createMockHostBridge } from "../../test/host-bridge";
import { renderWithProviders } from "../../test/render";

type UpdateEventListener = (event: UpdateEvent) => void;

type ToastSuccessCall = [
  string,
  { id?: string; duration?: number; action?: { label: string; onClick: () => void } },
];

function lastToastCall(mock: { mock: { calls: unknown[][] } }): ToastSuccessCall {
  const calls = mock.mock.calls as unknown as ToastSuccessCall[];
  return calls[calls.length - 1];
}

let listeners: UpdateEventListener[] = [];
let openExternal: ReturnType<typeof vi.fn>;

function createBridge(withUpdater: boolean, overrides: Partial<NonNullable<HostBridge["updater"]>> = {}): HostBridge {
  const bridge = createMockHostBridge({ openExternal: openExternal as never });
  if (!withUpdater) return bridge;
  return {
    ...bridge,
    updater: {
      getAppVersion: async () => "1.0.0",
      getUpdateState: async () => ({ status: "idle" }),
      checkForUpdates: vi.fn(async () => {}),
      downloadUpdate: vi.fn(async () => {}),
      cancelUpdate: vi.fn(async () => {}),
      installUpdate: vi.fn(async () => {}),
      onUpdateEvent: (callback: UpdateEventListener) => {
        listeners.push(callback);
        return () => { listeners = listeners.filter((listener) => listener !== callback); };
      },
      ...overrides,
    },
  };
}

function renderBridge(bridge: HostBridge) {
  return renderWithProviders(<UpdateNoticeBridge />, { bridge });
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
  cleanup();
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

  it("downloads in the background from a deduplicated Windows discovery toast", async () => {
    const bridge = createBridge(true);
    const success = vi.spyOn(toast, "success");
    const dismiss = vi.spyOn(toast, "dismiss");
    renderBridge(bridge);
    await act(async () => {});
    emit({ type: "update-state", state: { status: "available", updateMode: "inApp", version: "2.0.0" } });
    const event: UpdateEvent = { type: "update-available", version: "2.0.0", releaseNotes: "", silent: true, updateMode: "inApp" };
    emit(event);
    const first = lastToastCall(success);
    emit(event);
    expect(lastToastCall(success)[1].id).toBe(first[1].id);
    expect(first[1].action?.label).toBe("后台下载");
    await act(async () => { first[1].action?.onClick(); first[1].action?.onClick(); });
    expect(bridge.updater!.downloadUpdate).toHaveBeenCalledOnce();
    expect(bridge.openExternal).not.toHaveBeenCalled();
    expect(dismiss).toHaveBeenCalledWith(first[1].id);
    emit({ type: "update-state", state: { status: "downloading", updateMode: "inApp", percent: 0 } });
    emit(event);
    await act(async () => first[1].action?.onClick());
    expect(bridge.updater!.downloadUpdate).toHaveBeenCalledOnce();
    expect(success).toHaveBeenCalledTimes(2);
  });

  it("retires discovery after an About-page download and offers installation on completion", async () => {
    const bridge = createBridge(true);
    const success = vi.spyOn(toast, "success");
    const dismiss = vi.spyOn(toast, "dismiss");
    renderBridge(bridge);
    emit({ type: "update-available", version: "2.0.0", releaseNotes: "", silent: true, updateMode: "inApp" });
    const availableId = lastToastCall(success)[1].id;
    emit({ type: "update-state", state: { status: "downloading", updateMode: "inApp", percent: 0 } });
    expect(dismiss).toHaveBeenCalledWith(availableId);
    const state: UpdateState = { status: "downloaded", updateMode: "inApp", version: "2.0.0" };
    emit({ type: "update-state", state });
    const [title, options] = lastToastCall(success);
    expect(title).toBe("下载成功");
    expect(options.id).toBeTruthy();
    expect(options.action?.label).toBe("安装并重启");
    emit({ type: "update-state", state });
    expect(lastToastCall(success)[1].id).toBe(options.id);
    await act(async () => { options.action?.onClick(); options.action?.onClick(); });
    expect(bridge.updater!.installUpdate).toHaveBeenCalledOnce();
    emit({ type: "update-state", state: { ...state, status: "installing" } });
    expect(dismiss).toHaveBeenCalledWith(options.id);
    await act(async () => options.action?.onClick());
    expect(bridge.updater!.installUpdate).toHaveBeenCalledOnce();
  });

  it("rehydrates the downloaded toast after remount using the same ID", async () => {
    const bridge = createBridge(true, { getUpdateState: async () => ({ status: "downloaded", updateMode: "inApp" }) });
    const success = vi.spyOn(toast, "success");
    const first = renderBridge(bridge);
    await act(async () => {});
    const id = lastToastCall(success)[1].id;
    toast.dismiss(id);
    first.unmount();
    renderBridge(bridge);
    await act(async () => {});
    expect(lastToastCall(success)[1].id).toBe(id);
    expect(lastToastCall(success)[0]).toBe("下载成功");
  });

  it("subscribes before reading and does not restore an obsolete downloaded snapshot", async () => {
    let resolve!: (state: UpdateState) => void;
    const bridge = createBridge(true, { getUpdateState: () => {
      expect(listeners).toHaveLength(1);
      return new Promise((done) => { resolve = done; });
    } });
    const success = vi.spyOn(toast, "success");
    renderBridge(bridge);
    emit({ type: "update-state", state: { status: "installing", updateMode: "inApp" } });
    await act(async () => resolve({ status: "downloaded", updateMode: "inApp" }));
    expect(success).not.toHaveBeenCalled();
  });

  it("ignores late snapshots and removes subscriptions after unmount", async () => {
    let resolve!: (state: UpdateState) => void;
    const bridge = createBridge(true, { getUpdateState: () => new Promise((done) => { resolve = done; }) });
    const success = vi.spyOn(toast, "success");
    const { unmount } = renderBridge(bridge);
    unmount();
    await act(async () => resolve({ status: "downloaded", updateMode: "inApp" }));
    expect(success).not.toHaveBeenCalled();
    expect(listeners).toHaveLength(0);
  });

  it("shows download/install errors from authoritative states but keeps check errors quiet", () => {
    const error = vi.spyOn(toast, "error");
    renderBridge(createBridge(true));
    emit({ type: "update-state", state: { status: "error", updateMode: "inApp", errorPhase: "check" } });
    expect(error).not.toHaveBeenCalled();
    emit({ type: "update-state", state: { status: "error", updateMode: "inApp", errorPhase: "download" } });
    expect(error).toHaveBeenLastCalledWith("下载失败", expect.objectContaining({ id: "update-error" }));
    emit({ type: "update-state", state: { status: "error", updateMode: "inApp", errorPhase: "install" } });
    expect(error).toHaveBeenLastCalledWith("安装失败", expect.objectContaining({ id: "update-error" }));
  });

  it.each(["download", "install"] as const)("handles %s IPC failure without unhandled rejection", async (phase) => {
    const error = vi.spyOn(toast, "error");
    const success = vi.spyOn(toast, "success");
    const bridge = createBridge(true, {
      downloadUpdate: vi.fn().mockRejectedValue(new Error("IPC unavailable")),
      installUpdate: vi.fn().mockRejectedValue(new Error("IPC unavailable")),
      getUpdateState: async () => ({ status: phase === "install" ? "downloaded" : "available", updateMode: "inApp" }),
    });
    renderBridge(bridge);
    await act(async () => {});
    if (phase === "download") emit({ type: "update-available", version: "2.0.0", releaseNotes: "", silent: true, updateMode: "inApp" });
    await act(async () => lastToastCall(success)[1].action?.onClick());
    expect(error).toHaveBeenCalledWith(phase === "download" ? "下载失败" : "安装失败", expect.objectContaining({ id: "update-error" }));
    if (phase === "install") expect(success).toHaveBeenCalledTimes(2);
  });

  it("does not toast late IPC failure after unmount", async () => {
    let reject!: (error: Error) => void;
    const error = vi.spyOn(toast, "error");
    const success = vi.spyOn(toast, "success");
    const bridge = createBridge(true, { installUpdate: () => new Promise((_, fail) => { reject = fail; }) });
    const { unmount } = renderBridge(bridge);
    emit({ type: "update-state", state: { status: "downloaded", updateMode: "inApp" } });
    const action = lastToastCall(success)[1].action!;
    act(() => action.onClick());
    unmount();
    await act(async () => reject(new Error("late")));
    expect(error).not.toHaveBeenCalled();
    action.onClick();
  });

  it("handles snapshot IPC failure quietly", async () => {
    const error = vi.spyOn(toast, "error");
    const success = vi.spyOn(toast, "success");
    renderBridge(createBridge(true, { getUpdateState: vi.fn().mockRejectedValue(new Error("IPC unavailable")) }));
    await act(async () => {});
    expect(error).not.toHaveBeenCalled();
    expect(success).not.toHaveBeenCalled();
  });

  it("keeps the About page and global toast synchronized across closing and reopening settings", async () => {
    const success = vi.spyOn(toast, "success");
    let state: UpdateState = { status: "available", updateMode: "inApp", version: "2.0.0" };
    const bridge = createBridge(true, {
      getUpdateState: async () => state,
      downloadUpdate: vi.fn(async () => {
        state = { ...state, status: "downloading", percent: 0 };
        emit({ type: "update-state", state });
      }),
      installUpdate: vi.fn(async () => {
        state = { ...state, status: "installing" };
        emit({ type: "update-state", state });
      }),
    });
    const { rerender } = renderWithProviders(<><UpdateNoticeBridge /><UpdateChecker /></>, { bridge });
    await userEvent.setup().click(await screen.findByRole("button", { name: "后台下载" }));
    expect(bridge.updater!.downloadUpdate).toHaveBeenCalledOnce();
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "0");
    rerender(<><UpdateNoticeBridge /></>);
    expect(bridge.updater!.cancelUpdate).not.toHaveBeenCalled();
    state = { ...state, status: "downloaded" };
    emit({ type: "update-state", state });
    expect(lastToastCall(success)[0]).toBe("下载成功");
    toast.dismiss(lastToastCall(success)[1].id);
    rerender(<><UpdateNoticeBridge /><UpdateChecker /></>);
    await userEvent.setup().click(await screen.findByRole("button", { name: "安装并重启" }));
    expect(bridge.updater!.installUpdate).toHaveBeenCalledOnce();
    expect(screen.getByRole("button", { name: "正在安装并重启..." })).toBeDisabled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
