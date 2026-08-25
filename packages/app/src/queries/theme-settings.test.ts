import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ApiClient } from "../lib/api";
import { queryClient } from "./client";
import { projectQueryKeys } from "./keys";
import {
  invalidateThemeSettings,
  themeSettingsQueryOptions,
  updateProjectThemeSettings,
} from "./theme-settings";

function fakeClient(content: string): ApiClient {
  return {
    getThemeSettings: vi.fn().mockResolvedValue({ content }),
    updateThemeSettings: vi.fn().mockResolvedValue({ ok: true }),
  } as unknown as ApiClient;
}

describe("theme settings query", () => {
  beforeEach(() => {
    queryClient.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("keys the query to the project theme-settings domain and keeps cache alive after gc", () => {
    const client = fakeClient("");
    const options = themeSettingsQueryOptions("p1", client, true);
    expect(options.queryKey).toEqual(projectQueryKeys.themeSettings("p1"));
    expect(options.enabled).toBe(true);
    expect(options.gcTime).toBe(Number.POSITIVE_INFINITY);
    expect(themeSettingsQueryOptions("p1", client, false).enabled).toBe(false);
  });

  it("serves the cached content on remount without refetching", async () => {
    const client = fakeClient("body { color: red }");

    await queryClient.fetchQuery(themeSettingsQueryOptions("p1", client, true));
    await queryClient.fetchQuery(themeSettingsQueryOptions("p1", client, true));

    expect(client.getThemeSettings).toHaveBeenCalledTimes(1);
  });

  it("refetches after invalidation", async () => {
    const client = fakeClient("");

    await queryClient.fetchQuery(themeSettingsQueryOptions("p1", client, true));
    await invalidateThemeSettings("p1");
    await queryClient.fetchQuery(themeSettingsQueryOptions("p1", client, true));

    expect(client.getThemeSettings).toHaveBeenCalledTimes(2);
  });

  it("persists updates through the facade and invalidates the cache", async () => {
    const client = fakeClient("");

    await queryClient.fetchQuery(themeSettingsQueryOptions("p1", client, true));
    await updateProjectThemeSettings("p1", client, "body { color: blue }");
    await queryClient.fetchQuery(themeSettingsQueryOptions("p1", client, true));

    expect(client.updateThemeSettings).toHaveBeenCalledWith("body { color: blue }");
    expect(client.getThemeSettings).toHaveBeenCalledTimes(2);
  });

  it("keeps per-project content isolated", async () => {
    const clientA = fakeClient("a");
    const clientB = fakeClient("b");

    const a = await queryClient.fetchQuery(themeSettingsQueryOptions("p1", clientA, true));
    const b = await queryClient.fetchQuery(themeSettingsQueryOptions("p2", clientB, true));

    expect(a).toEqual({ content: "a" });
    expect(b).toEqual({ content: "b" });
  });
});
