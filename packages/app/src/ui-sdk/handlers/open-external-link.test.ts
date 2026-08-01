import { beforeEach, describe, expect, it, vi } from "vitest";

const openExternalUrlMock = vi.fn();
vi.mock("../../features/browser/open-external-url", async () => {
  const actual = await vi.importActual<typeof import("../../features/browser/open-external-url")>(
    "../../features/browser/open-external-url",
  );
  return { ...actual, openExternalUrl: openExternalUrlMock };
});

const { dispatchAction } = await import("../registry");
await import("./open-external-link");

function makeCtx(openExternal: ReturnType<typeof vi.fn>) {
  return {
    projectId: "proj-1",
    navigate: vi.fn(),
    hostKind: "electron" as const,
    openExternal,
  } as any;
}

describe("openExternalLink action", () => {
  let openExternal: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    openExternal = vi.fn().mockResolvedValue(undefined);
    openExternalUrlMock.mockReset();
  });

  it("forwards a trimmed external url to openExternal", async () => {
    dispatchAction("openExternalLink", { url: "  https://example.com/page  " }, makeCtx(openExternal));
    await Promise.resolve();
    expect(openExternal).toHaveBeenCalledWith("https://example.com/page");
    expect(openExternalUrlMock).not.toHaveBeenCalled();
  });

  it("routes loopback urls through the in-app browser resolver", async () => {
    dispatchAction("openExternalLink", { url: "http://localhost:3000" }, makeCtx(openExternal));
    await Promise.resolve();
    expect(openExternalUrlMock).toHaveBeenCalledWith("http://localhost:3000", expect.objectContaining({ projectId: "proj-1" }));
    expect(openExternal).not.toHaveBeenCalled();
  });

  it("ignores non-string url", async () => {
    dispatchAction("openExternalLink", { url: 42 }, makeCtx(openExternal));
    await Promise.resolve();
    expect(openExternal).not.toHaveBeenCalled();
    expect(openExternalUrlMock).not.toHaveBeenCalled();
  });

  it("ignores empty / whitespace-only url", async () => {
    dispatchAction("openExternalLink", { url: "   " }, makeCtx(openExternal));
    await Promise.resolve();
    expect(openExternal).not.toHaveBeenCalled();
    expect(openExternalUrlMock).not.toHaveBeenCalled();
  });

  it("ignores missing url param", async () => {
    dispatchAction("openExternalLink", {}, makeCtx(openExternal));
    await Promise.resolve();
    expect(openExternal).not.toHaveBeenCalled();
    expect(openExternalUrlMock).not.toHaveBeenCalled();
  });
});
