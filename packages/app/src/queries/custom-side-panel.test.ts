import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ApiClient } from "../lib/api";
import { queryClient } from "./client";
import { projectQueryKeys } from "./keys";
import {
  customSidePanelQueryOptions,
  invalidateCustomSidePanel,
  updateCustomSidePanelSettings,
} from "./custom-side-panel";

function fakeClient(settings: { path: string | null }): ApiClient {
  return {
    getSidePanelSettings: vi.fn().mockResolvedValue(settings),
    getPreviewUrl: (filePath: string) => `http://preview/${filePath}`,
  } as unknown as ApiClient;
}

function stubProbeFetch(okByUrl: Record<string, boolean>) {
  return vi.fn((input: RequestInfo | URL) => {
    const url = String(input);
    return Promise.resolve({ ok: okByUrl[url] ?? false } as Response);
  });
}

describe("custom side panel query", () => {
  beforeEach(() => {
    queryClient.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("keys the query to the project custom-side-panel domain and survives gc between mounts", () => {
    const client = fakeClient({ path: null });
    const options = customSidePanelQueryOptions("p1", client);
    expect(options.queryKey).toEqual(projectQueryKeys.customSidePanel("p1"));
    expect(options.gcTime).toBe(Number.POSITIVE_INFINITY);
  });

  it("resolves the configured path when its file exists", async () => {
    const client = fakeClient({ path: "panel/index.html" });
    vi.stubGlobal("fetch", stubProbeFetch({ "http://preview/panel/index.html": true }));

    const data = await queryClient.fetchQuery(customSidePanelQueryOptions("p1", client));

    expect(data).toEqual({ path: "panel/index.html" });
  });

  it("resolves a null path when nothing is configured, without index.html fallback", async () => {
    const client = fakeClient({ path: null });
    const fetchMock = stubProbeFetch({ "http://preview/index.html": true });
    vi.stubGlobal("fetch", fetchMock);

    const data = await queryClient.fetchQuery(customSidePanelQueryOptions("p1", client));

    expect(data).toEqual({ path: null });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("resolves a null path when the configured file is unreachable", async () => {
    const client = fakeClient({ path: "gone.html" });
    vi.stubGlobal("fetch", stubProbeFetch({}));

    const data = await queryClient.fetchQuery(customSidePanelQueryOptions("p1", client));

    expect(data).toEqual({ path: null });
  });

  it("propagates settings fetch errors instead of caching them as a missing panel", async () => {
    const client = {
      getSidePanelSettings: vi.fn().mockRejectedValue(new Error("offline")),
    } as unknown as ApiClient;

    await expect(
      queryClient.fetchQuery(customSidePanelQueryOptions("p1", client)),
    ).rejects.toThrow("offline");
  });

  it("refetches after the settings dialog invalidates the cache", async () => {
    const client = fakeClient({ path: "panel/index.html" });
    vi.stubGlobal("fetch", stubProbeFetch({ "http://preview/panel/index.html": true }));

    await queryClient.fetchQuery(customSidePanelQueryOptions("p1", client));
    await invalidateCustomSidePanel("p1");
    await queryClient.fetchQuery(customSidePanelQueryOptions("p1", client));

    expect(client.getSidePanelSettings).toHaveBeenCalledTimes(2);
  });

  it("invalidates the cache after updating settings", async () => {
    const client = {
      getSidePanelSettings: vi.fn().mockResolvedValue({ path: null }),
      updateSidePanelSettings: vi.fn().mockResolvedValue({ path: "panel/index.html" }),
      getPreviewUrl: (filePath: string) => `http://preview/${filePath}`,
    } as unknown as ApiClient;

    await queryClient.fetchQuery(customSidePanelQueryOptions("p1", client));
    const result = await updateCustomSidePanelSettings("p1", client, "panel/index.html");
    await queryClient.fetchQuery(customSidePanelQueryOptions("p1", client));

    expect(result).toEqual({ path: "panel/index.html" });
    expect(client.updateSidePanelSettings).toHaveBeenCalledWith("panel/index.html");
    expect(client.getSidePanelSettings).toHaveBeenCalledTimes(2);
  });

  it("keeps per-project resolutions isolated", async () => {
    const clientA = fakeClient({ path: "a.html" });
    const clientB = fakeClient({ path: "b.html" });
    vi.stubGlobal(
      "fetch",
      stubProbeFetch({ "http://preview/a.html": true, "http://preview/b.html": true }),
    );

    const a = await queryClient.fetchQuery(customSidePanelQueryOptions("p1", clientA));
    const b = await queryClient.fetchQuery(customSidePanelQueryOptions("p2", clientB));

    expect(a).toEqual({ path: "a.html" });
    expect(b).toEqual({ path: "b.html" });
  });
});
