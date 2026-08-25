import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ApiClient } from "../lib/api";
import { queryClient } from "./client";
import { projectQueryKeys } from "./keys";
import { invalidateWelcomePage, updateWelcomePageSettings, welcomePageQueryOptions } from "./welcome-page";

function fakeClient(settings: { path: string | null }): ApiClient {
  return {
    getWelcomePageSettings: vi.fn().mockResolvedValue(settings),
    getPreviewUrl: (filePath: string) => `http://preview/${filePath}`,
  } as unknown as ApiClient;
}

function stubProbeFetch(okByUrl: Record<string, boolean>) {
  return vi.fn((input: RequestInfo | URL) => {
    const url = String(input);
    return Promise.resolve({ ok: okByUrl[url] ?? false } as Response);
  });
}

describe("welcome page query", () => {
  beforeEach(() => {
    queryClient.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("keys the query to the project welcome-page domain and survives gc between mounts", () => {
    const client = fakeClient({ path: null });
    const options = welcomePageQueryOptions("p1", client);
    expect(options.queryKey).toEqual(projectQueryKeys.welcomePage("p1"));
    expect(options.gcTime).toBe(Number.POSITIVE_INFINITY);
  });

  it("resolves the configured path when its file exists", async () => {
    const client = fakeClient({ path: "welcome.html" });
    const fetchMock = stubProbeFetch({ "http://preview/welcome.html": true });
    vi.stubGlobal("fetch", fetchMock);

    const data = await queryClient.fetchQuery(welcomePageQueryOptions("p1", client));

    expect(data).toEqual({ path: "welcome.html" });
  });

  it("falls back to project root index.html when no welcome page is configured", async () => {
    const client = fakeClient({ path: null });
    const fetchMock = stubProbeFetch({ "http://preview/index.html": true });
    vi.stubGlobal("fetch", fetchMock);

    const data = await queryClient.fetchQuery(welcomePageQueryOptions("p1", client));

    expect(data).toEqual({ path: "index.html" });
  });

  it("resolves a null path when the configured file or fallback is missing", async () => {
    const client = fakeClient({ path: "gone.html" });
    vi.stubGlobal("fetch", stubProbeFetch({}));

    const data = await queryClient.fetchQuery(welcomePageQueryOptions("p1", client));

    expect(data).toEqual({ path: null });
  });

  it("propagates settings fetch errors instead of caching them as a missing page", async () => {
    const client = {
      getWelcomePageSettings: vi.fn().mockRejectedValue(new Error("offline")),
    } as unknown as ApiClient;

    await expect(
      queryClient.fetchQuery(welcomePageQueryOptions("p1", client)),
    ).rejects.toThrow("offline");
  });

  it("serves the cached resolution on remount without refetching", async () => {
    const client = fakeClient({ path: "welcome.html" });
    vi.stubGlobal("fetch", stubProbeFetch({ "http://preview/welcome.html": true }));

    await queryClient.fetchQuery(welcomePageQueryOptions("p1", client));
    await queryClient.fetchQuery(welcomePageQueryOptions("p1", client));

    expect(client.getWelcomePageSettings).toHaveBeenCalledTimes(1);
  });

  it("refetches after the settings dialog invalidates the cache", async () => {
    const client = fakeClient({ path: "welcome.html" });
    vi.stubGlobal("fetch", stubProbeFetch({ "http://preview/welcome.html": true }));

    await queryClient.fetchQuery(welcomePageQueryOptions("p1", client));
    await invalidateWelcomePage("p1");
    await queryClient.fetchQuery(welcomePageQueryOptions("p1", client));

    expect(client.getWelcomePageSettings).toHaveBeenCalledTimes(2);
  });

  it("invalidates the cache after updating settings", async () => {
    const client = {
      getWelcomePageSettings: vi.fn().mockResolvedValue({ path: null }),
      updateWelcomePageSettings: vi.fn().mockResolvedValue({ path: "welcome.html" }),
      getPreviewUrl: (filePath: string) => `http://preview/${filePath}`,
    } as unknown as ApiClient;
    vi.stubGlobal("fetch", stubProbeFetch({ "http://preview/index.html": true }));

    await queryClient.fetchQuery(welcomePageQueryOptions("p1", client));
    const result = await updateWelcomePageSettings("p1", client, "welcome.html");
    await queryClient.fetchQuery(welcomePageQueryOptions("p1", client));

    expect(result).toEqual({ path: "welcome.html" });
    expect(client.updateWelcomePageSettings).toHaveBeenCalledWith("welcome.html");
    expect(client.getWelcomePageSettings).toHaveBeenCalledTimes(2);
  });

  it("keeps per-project resolutions isolated", async () => {
    const clientA = fakeClient({ path: "a.html" });
    const clientB = fakeClient({ path: "b.html" });
    vi.stubGlobal(
      "fetch",
      stubProbeFetch({ "http://preview/a.html": true, "http://preview/b.html": true }),
    );

    const a = await queryClient.fetchQuery(welcomePageQueryOptions("p1", clientA));
    const b = await queryClient.fetchQuery(welcomePageQueryOptions("p2", clientB));

    expect(a).toEqual({ path: "a.html" });
    expect(b).toEqual({ path: "b.html" });
  });
});
