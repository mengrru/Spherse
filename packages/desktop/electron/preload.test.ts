import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import type { ElectronAPI, UpdateEvent } from "./types.js";

const { expose, invoke } = vi.hoisted(() => ({ expose: vi.fn(), invoke: vi.fn() }));
const ipc = new EventEmitter();
vi.mock("electron", () => ({
  contextBridge: { exposeInMainWorld: expose },
  ipcRenderer: { on: (...args: Parameters<typeof ipc.on>) => ipc.on(...args), removeListener: (...args: Parameters<typeof ipc.removeListener>) => ipc.removeListener(...args), invoke },
}));

describe("preload updater bridge", () => {
  it("forwards authoritative state and legacy notifications and unsubscribes independently", async () => {
    await import("./preload.js");
    const api = expose.mock.calls[0][1] as ElectronAPI;
    const first = vi.fn();
    const second = vi.fn();
    const unsubscribe = api.onUpdateEvent(first);
    const unsubscribeSecond = api.onUpdateEvent(second);
    const state: UpdateEvent = { type: "update-state", state: { status: "downloaded", updateMode: "inApp", version: "0.2.0" } };
    ipc.emit("update-state", {}, state);
    expect(first).toHaveBeenCalledExactlyOnceWith(state);
    expect(second).toHaveBeenCalledExactlyOnceWith(state);
    unsubscribe();
    const available: UpdateEvent = { type: "update-available", version: "0.2.0", releaseNotes: "", updateMode: "external", silent: true };
    ipc.emit("update-available", {}, available);
    ipc.emit("update-state", {}, state);
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(3);
    unsubscribeSecond();
    expect(ipc.eventNames()).toEqual([]);
    await api.installUpdate();
    expect(invoke).toHaveBeenLastCalledWith("install-update");
  });
});
