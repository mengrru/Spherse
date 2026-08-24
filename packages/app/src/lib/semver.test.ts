import { describe, expect, it } from "vitest";
import { compareSemver, isValidSemver } from "./semver";

describe("semver wrapper (compare-versions)", () => {
  it("validates strict semver", () => {
    expect(isValidSemver("1.0.0")).toBe(true);
    expect(isValidSemver("1.0.0-alpha.1")).toBe(true);
    expect(isValidSemver("v1.2.3")).toBe(false);
    expect(isValidSemver("latest")).toBe(false);
  });

  it("orders versions per semver rules", () => {
    expect(compareSemver("1.0.0", "1.0.1")).toBeLessThan(0);
    expect(compareSemver("1.0.0-alpha", "1.0.0")).toBeLessThan(0);
    expect(compareSemver("1.2.3+build.1", "1.2.3+build.2")).toBe(0);
  });

  it("returns null for invalid input instead of throwing", () => {
    expect(compareSemver("", "1.0.0")).toBeNull();
    expect(compareSemver("1.0.0", "latest")).toBeNull();
  });
});
