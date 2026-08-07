import { describe, expect, it } from "vitest";
import { isInsideAnyOpenProject } from "./open-file-path.js";

describe("isInsideAnyOpenProject", () => {
  it("returns true for a file nested inside an open project root", () => {
    const root = "/home/user/my-project";
    expect(isInsideAnyOpenProject("/home/user/my-project/docs/report.pdf", [root])).toBe(true);
  });

  it("returns true for a file directly inside the project root", () => {
    const root = "/home/user/my-project";
    expect(isInsideAnyOpenProject("/home/user/my-project/report.pdf", [root])).toBe(true);
  });

  it("returns false for a file outside all open project roots", () => {
    const root = "/home/user/my-project";
    expect(isInsideAnyOpenProject("/home/user/elsewhere/report.pdf", [root])).toBe(false);
  });

  it("returns false for a sibling directory that shares the project name prefix (no path traversal false positive)", () => {
    const root = "/home/user/my-project";
    expect(isInsideAnyOpenProject("/home/user/my-project-other/x.pdf", [root])).toBe(false);
  });

  it("checks against any of multiple open projects", () => {
    const roots = ["/home/user/a", "/home/user/b"];
    expect(isInsideAnyOpenProject("/home/user/b/nested/file.pdf", roots)).toBe(true);
  });

  it("matches regardless of trailing slash on the project root", () => {
    expect(isInsideAnyOpenProject("/home/user/p/file.pdf", ["/home/user/p/"])).toBe(true);
  });
});
