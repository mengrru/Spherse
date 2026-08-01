import { describe, expect, it } from "vitest";
import { FEATURE_HOST_MATRIX, isFeatureEnabled } from "./feature-registry";

describe("feature-registry", () => {
  it("declares every gated feature as electron-only in the current matrix", () => {
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
      expect(FEATURE_HOST_MATRIX[feature].has("web")).toBe(false);
    }
  });

  it("enables every gated feature on the electron host", () => {
    const allFeatures = Object.keys(FEATURE_HOST_MATRIX) as Array<keyof typeof FEATURE_HOST_MATRIX>;
    for (const feature of allFeatures) {
      expect(isFeatureEnabled(feature, "electron")).toBe(true);
    }
  });

  it("disables every gated feature on the web host", () => {
    const allFeatures = Object.keys(FEATURE_HOST_MATRIX) as Array<keyof typeof FEATURE_HOST_MATRIX>;
    for (const feature of allFeatures) {
      expect(isFeatureEnabled(feature, "web")).toBe(false);
    }
  });
});
