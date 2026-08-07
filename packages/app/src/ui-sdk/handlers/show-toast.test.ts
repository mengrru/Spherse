import { beforeEach, describe, expect, it, vi } from "vitest";

const mockToast = vi.fn();
const mockSuccess = vi.fn();
const mockError = vi.fn();
const mockWarning = vi.fn();
const mockInfo = vi.fn();

vi.mock("sonner", () => ({
  toast: Object.assign(mockToast, {
    success: mockSuccess,
    error: mockError,
    warning: mockWarning,
    info: mockInfo,
  }),
}));

const { dispatchAction } = await import("../registry");
await import("./show-toast");

const ctx = { projectId: "proj-1" } as any;

describe("showToast action", () => {
  beforeEach(() => {
    mockToast.mockReset();
    mockSuccess.mockReset();
    mockError.mockReset();
    mockWarning.mockReset();
    mockInfo.mockReset();
  });

  it("is a no-op when message is missing or not a string", async () => {
    await dispatchAction("showToast", {}, ctx);
    await dispatchAction("showToast", { message: 123 }, ctx);
    await dispatchAction("showToast", { message: "" }, ctx);
    expect(mockToast).not.toHaveBeenCalled();
    expect(mockSuccess).not.toHaveBeenCalled();
    expect(mockError).not.toHaveBeenCalled();
  });

  it("calls default toast when variant is omitted", async () => {
    await dispatchAction("showToast", { message: "hi" }, ctx);
    expect(mockToast).toHaveBeenCalledWith("hi", undefined);
    expect(mockSuccess).not.toHaveBeenCalled();
  });

  it("routes to the matching sonner variant", async () => {
    await dispatchAction("showToast", { variant: "success", message: "ok" }, ctx);
    await dispatchAction("showToast", { variant: "error", message: "bad" }, ctx);
    await dispatchAction("showToast", { variant: "warning", message: "careful" }, ctx);
    await dispatchAction("showToast", { variant: "info", message: "fyi" }, ctx);
    expect(mockSuccess).toHaveBeenCalledWith("ok", undefined);
    expect(mockError).toHaveBeenCalledWith("bad", undefined);
    expect(mockWarning).toHaveBeenCalledWith("careful", undefined);
    expect(mockInfo).toHaveBeenCalledWith("fyi", undefined);
  });

  it("falls back to default toast for unknown variant", async () => {
    await dispatchAction("showToast", { variant: "loud", message: "x" }, ctx);
    expect(mockToast).toHaveBeenCalledWith("x", undefined);
    expect(mockSuccess).not.toHaveBeenCalled();
  });

  it("forwards description as sonner options", async () => {
    await dispatchAction(
      "showToast",
      { variant: "success", message: "saved", description: "world/game.html" },
      ctx,
    );
    expect(mockSuccess).toHaveBeenCalledWith("saved", { description: "world/game.html" });
  });

  it("ignores non-string description", async () => {
    await dispatchAction(
      "showToast",
      { message: "m", description: 42 },
      ctx,
    );
    expect(mockToast).toHaveBeenCalledWith("m", undefined);
  });
});
