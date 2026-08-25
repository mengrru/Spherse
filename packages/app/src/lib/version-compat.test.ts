import { describe, expect, it } from "vitest";
import { compareAppVersion } from "./version-compat";

describe("compareAppVersion", () => {
  it("returns ok for identical versions", () => {
    expect(compareAppVersion("1.2.3", "1.2.3")).toBe("ok");
  });

  it("returns patch-mismatch when only the patch differs", () => {
    expect(compareAppVersion("1.2.3", "1.2.4")).toBe("patch-mismatch");
    expect(compareAppVersion("1.2.10", "1.2.9")).toBe("patch-mismatch");
  });

  it("returns incompatible when major or minor differ", () => {
    expect(compareAppVersion("1.2.3", "2.0.0")).toBe("incompatible");
    expect(compareAppVersion("1.2.3", "1.3.0")).toBe("incompatible");
    expect(compareAppVersion("0.9.1", "0.10.0")).toBe("incompatible");
  });

  it("returns unknown when either version is missing or unparseable", () => {
    expect(compareAppVersion(null, "1.2.3")).toBe("unknown");
    expect(compareAppVersion(undefined, "1.2.3")).toBe("unknown");
    expect(compareAppVersion("dev", "1.2.3")).toBe("unknown");
    expect(compareAppVersion("1.2.3", "not-a-version")).toBe("unknown");
    expect(compareAppVersion("1.2.3", "1.2")).toBe("unknown");
  });

  it("treats pre-release versions as patch-level mismatch (valid semver)", () => {
    expect(compareAppVersion("1.2.3-beta.1", "1.2.3")).toBe("patch-mismatch");
    expect(compareAppVersion("1.2.3", "1.3.0-rc.1")).toBe("incompatible");
  });
});
