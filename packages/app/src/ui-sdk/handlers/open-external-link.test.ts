import { beforeEach, describe, expect, it, vi } from "vitest";

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
  });

  it("forwards a trimmed external url to openExternal", async () => {
    dispatchAction("openExternalLink", { url: "  https://example.com/page  " }, makeCtx(openExternal));
    await Promise.resolve();
    expect(openExternal).toHaveBeenCalledWith("https://example.com/page");
  });

  it("ignores non-string url", async () => {
    dispatchAction("openExternalLink", { url: 42 }, makeCtx(openExternal));
    await Promise.resolve();
    expect(openExternal).not.toHaveBeenCalled();
  });

  it("ignores empty / whitespace-only url", async () => {
    dispatchAction("openExternalLink", { url: "   " }, makeCtx(openExternal));
    await Promise.resolve();
    expect(openExternal).not.toHaveBeenCalled();
  });

  it("ignores missing url param", async () => {
    dispatchAction("openExternalLink", {}, makeCtx(openExternal));
    await Promise.resolve();
    expect(openExternal).not.toHaveBeenCalled();
  });
});
