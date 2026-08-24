import { describe, expect, it } from "vitest";
import { marketplaceSkillsQueryOptions } from "./skills";
import { projectQueryKeys } from "./keys";
import type { ApiClient } from "../lib/api";

const fakeClient = {} as ApiClient;

describe("marketplaceSkillsQueryOptions", () => {
  it("keys the query to the project marketplace skills domain", () => {
    const options = marketplaceSkillsQueryOptions("p1", fakeClient, true);
    expect(options.queryKey).toEqual(projectQueryKeys.marketplaceSkills("p1"));
  });

  it("passes enabled through", () => {
    expect(marketplaceSkillsQueryOptions("p1", fakeClient, true).enabled).toBe(true);
    expect(marketplaceSkillsQueryOptions("p1", fakeClient, false).enabled).toBe(false);
  });

  it("opts out of the global infinite staleTime so reopening refetches", () => {
    expect(marketplaceSkillsQueryOptions("p1", fakeClient, true).staleTime).toBe(0);
  });
});
