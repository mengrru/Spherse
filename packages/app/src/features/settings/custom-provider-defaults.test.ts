import { describe, expect, it } from "vitest";
import { CUSTOM_PROVIDER_DEFAULTS } from "@spherse/core";
import { customProviderDefaults } from "./custom-provider-defaults";

describe("customProviderDefaults", () => {
  it("matches CUSTOM_PROVIDER_DEFAULTS from @spherse/core", () => {
    expect(customProviderDefaults.contextWindow).toBe(CUSTOM_PROVIDER_DEFAULTS.contextWindow);
    expect(customProviderDefaults.maxTokens).toBe(CUSTOM_PROVIDER_DEFAULTS.maxTokens);
  });
});
