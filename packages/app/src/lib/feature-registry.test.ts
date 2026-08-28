import { describe, expect, it } from "vitest";
import { FEATURE_HOST_MATRIX, isFeatureEnabled } from "./feature-registry";

const WEB_ENABLED_FEATURES = ["agent-dialog", "agent-mcp", "agent-trigger"] as const;

describe("feature-registry", () => {
  it("declares the full gated feature set in the current matrix", () => {
    const allFeatures = Object.keys(FEATURE_HOST_MATRIX) as Array<keyof typeof FEATURE_HOST_MATRIX>;
    expect(allFeatures.sort()).toEqual(
      [
        "agent-dialog",
        "agent-mcp",
        "agent-trigger",
        "browser",
        "floating-chat",
        "floating-content-browser",
        "open-project",
        "settings",
        "text-selection-session",
      ].sort(),
    );
    for (const feature of allFeatures) {
      expect(FEATURE_HOST_MATRIX[feature].has("electron")).toBe(true);
    }
  });

  it("enables every gated feature on the electron host", () => {
    const allFeatures = Object.keys(FEATURE_HOST_MATRIX) as Array<keyof typeof FEATURE_HOST_MATRIX>;
    for (const feature of allFeatures) {
      expect(isFeatureEnabled(feature, "electron")).toBe(true);
    }
  });

  it("enables agent management features on the web host", () => {
    for (const feature of WEB_ENABLED_FEATURES) {
      expect(isFeatureEnabled(feature, "web")).toBe(true);
    }
  });

  it("keeps host-dependent features disabled on the web host", () => {
    const allFeatures = Object.keys(FEATURE_HOST_MATRIX) as Array<keyof typeof FEATURE_HOST_MATRIX>;
    for (const feature of allFeatures) {
      if ((WEB_ENABLED_FEATURES as readonly string[]).includes(feature)) continue;
      expect(isFeatureEnabled(feature, "web")).toBe(false);
    }
  });
});
