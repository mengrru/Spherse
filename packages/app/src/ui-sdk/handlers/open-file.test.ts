import { beforeEach, describe, expect, it, vi } from "vitest";

const mockOpenFloat = vi.fn();
const mockNavigate = vi.fn();

vi.mock("../../features/floating-content-browser/store", () => ({
  useFloatingContentBrowserStore: {
    getState: () => ({ openFloat: mockOpenFloat }),
  },
}));

const { dispatchAction } = await import("../registry");
await import("./open-file");

function makeCtx(hostKind: "electron" | "web" = "electron") {
  return {
    projectId: "proj-1",
    navigate: mockNavigate,
    hostKind,
  } as any;
}

describe("openFile action", () => {
  beforeEach(() => {
    mockOpenFloat.mockReset();
    mockNavigate.mockReset();
  });

  it("is a no-op when path is missing", async () => {
    await dispatchAction("openFile", {}, makeCtx());
    expect(mockOpenFloat).not.toHaveBeenCalled();
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it("is a no-op when path is not a string", async () => {
    await dispatchAction("openFile", { path: 123 }, makeCtx());
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it("navigates to content browser by default (no float) on electron", async () => {
    await dispatchAction("openFile", { path: "world/x.md" }, makeCtx("electron"));
    expect(mockNavigate).toHaveBeenCalledWith(
      "/project/proj-1/content?path=world%2Fx.md",
    );
    expect(mockOpenFloat).not.toHaveBeenCalled();
  });

  it("opens floating content when float is true on electron", async () => {
    await dispatchAction(
      "openFile",
      { path: "world/x.md", float: true },
      makeCtx("electron"),
    );
    expect(mockOpenFloat).toHaveBeenCalledWith("proj-1", "world/x.md");
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it("falls back to navigation on web even when float is true", async () => {
    await dispatchAction(
      "openFile",
      { path: "world/x.md", float: true },
      makeCtx("web"),
    );
    expect(mockOpenFloat).not.toHaveBeenCalled();
    expect(mockNavigate).toHaveBeenCalledWith(
      "/project/proj-1/content?path=world%2Fx.md",
    );
  });

  it("navigates when float is explicitly false on electron", async () => {
    await dispatchAction(
      "openFile",
      { path: "world/x.md", float: false },
      makeCtx("electron"),
    );
    expect(mockOpenFloat).not.toHaveBeenCalled();
    expect(mockNavigate).toHaveBeenCalledWith(
      "/project/proj-1/content?path=world%2Fx.md",
    );
  });
});
