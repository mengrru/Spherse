import { describe, expect, it } from "vitest";
import { normalizeSidePanelPath, normalizeWelcomePagePath } from "./project-page-paths";

describe("normalizeWelcomePagePath", () => {
  it("normalizes separators and leading ./", () => {
    expect(normalizeWelcomePagePath(".\\welcome\\index.html")).toBe("welcome/index.html");
  });

  it("accepts html and image extensions", () => {
    expect(normalizeWelcomePagePath("a.html")).toBe("a.html");
    expect(normalizeWelcomePagePath("b.PNG")).toBe("b.PNG");
    expect(normalizeWelcomePagePath("c.svg")).toBe("c.svg");
  });

  it("rejects absolute, traversal, meta-dir and unknown extensions", () => {
    for (const invalid of ["", ".", "/abs.html", "../x.html", ".spherse/a.html", "readme.md", "noext"]) {
      expect(normalizeWelcomePagePath(invalid)).toBeNull();
    }
  });
});

describe("normalizeSidePanelPath", () => {
  it("accepts html and htm only", () => {
    expect(normalizeSidePanelPath("panel/index.htm")).toBe("panel/index.htm");
    expect(normalizeSidePanelPath("poster.png")).toBeNull();
    expect(normalizeSidePanelPath("page.md")).toBeNull();
  });

  it("shares the same path rules as the welcome page validator", () => {
    for (const invalid of ["", ".", "/abs.html", "../x.html", ".spherse/a.html"]) {
      expect(normalizeSidePanelPath(invalid)).toBeNull();
    }
  });
});
