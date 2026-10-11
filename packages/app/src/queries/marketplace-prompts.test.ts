import { describe, expect, it } from "vitest";
import { marketplacePromptsQueryOptions, promptLanguageFromLocale } from "./marketplace-prompts";
import { marketplaceQueryKeys } from "./keys";
import type { GlobalApiClient } from "../lib/api";

const fakeClient = {} as GlobalApiClient;

describe("promptLanguageFromLocale", () => {
  it("maps app locales to asset language codes", () => {
    expect(promptLanguageFromLocale("zh-CN")).toBe("zh-cn");
    expect(promptLanguageFromLocale("zh-TW")).toBe("zh-tw");
    expect(promptLanguageFromLocale("en")).toBe("en-us");
  });
});

describe("marketplacePromptsQueryOptions", () => {
  it("keys the query to the marketplace prompts language domain", () => {
    const options = marketplacePromptsQueryOptions(fakeClient, "zh-cn", true);
    expect(options.queryKey).toEqual(marketplaceQueryKeys.prompts("zh-cn"));
  });

  it("passes enabled through and disables itself without a client", () => {
    expect(marketplacePromptsQueryOptions(fakeClient, "zh-cn", true).enabled).toBe(true);
    expect(marketplacePromptsQueryOptions(fakeClient, "zh-cn", false).enabled).toBe(false);
    expect(marketplacePromptsQueryOptions(null, "zh-cn", true).enabled).toBe(false);
  });

  it("opts out of the global infinite staleTime so reopening refetches", () => {
    expect(marketplacePromptsQueryOptions(fakeClient, "zh-cn", true).staleTime).toBe(0);
  });
});
