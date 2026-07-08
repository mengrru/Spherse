import { describe, expect, it } from "vitest";
import { isPathInsideProject, toProjectRelative, joinProjectPath } from "./project-path";

describe("isPathInsideProject", () => {
  it("accepts posix root and descendants", () => {
    const root = "/home/user/project";
    expect(isPathInsideProject(root, root)).toBe(true);
    expect(isPathInsideProject(root, "/home/user/project/docs/guide.md")).toBe(true);
  });

  it("rejects sibling paths sharing a string prefix", () => {
    const root = "/home/user/project";
    expect(isPathInsideProject(root, "/home/user/project-bak/secret.md")).toBe(false);
    expect(isPathInsideProject(root, "/home/user/projectile/x.md")).toBe(false);
  });

  it("rejects traversal outside the project", () => {
    const root = "/home/user/project";
    expect(isPathInsideProject(root, "/home/user/project/../../outside.md")).toBe(false);
  });

  it("accepts windows drive paths with backslashes", () => {
    const root = "C:\\Users\\foo\\project";
    expect(isPathInsideProject(root, root)).toBe(true);
    expect(isPathInsideProject(root, "C:\\Users\\foo\\project\\card.html")).toBe(true);
    expect(isPathInsideProject(root, "C:\\Users\\foo\\project\\sub\\card.html")).toBe(true);
  });

  it("rejects windows sibling paths sharing a string prefix", () => {
    const root = "C:\\Users\\foo\\project";
    expect(isPathInsideProject(root, "C:\\Users\\foo\\project-bak\\secret.md")).toBe(false);
  });

  it("is case-insensitive on windows drive and segments", () => {
    expect(isPathInsideProject("c:\\users\\foo\\project", "C:\\Users\\Foo\\Project\\Card.html")).toBe(true);
  });

  it("handles mixed separators", () => {
    expect(isPathInsideProject("C:\\Users\\foo\\project", "C:/Users/foo/project/card.html")).toBe(true);
  });

  it("rejects paths on a different drive", () => {
    expect(isPathInsideProject("C:\\Users\\foo\\project", "D:\\Users\\foo\\project\\card.html")).toBe(false);
  });

  it("rejects different posix roots", () => {
    expect(isPathInsideProject("/home/a/project", "/home/b/project/x.md")).toBe(false);
  });

  it("accepts UNC paths on the same share and rejects different shares", () => {
    expect(isPathInsideProject("\\\\server\\share\\proj", "\\\\server\\share\\proj\\a.md")).toBe(true);
    expect(isPathInsideProject("\\\\server\\share\\proj", "\\\\otherserver\\share\\proj\\a.md")).toBe(false);
    expect(isPathInsideProject("\\\\server\\share\\proj", "\\\\server\\othershare\\proj\\a.md")).toBe(false);
  });

  it("is case-sensitive on posix", () => {
    expect(isPathInsideProject("/home/user/project", "/home/user/Project/x.md")).toBe(false);
  });
});

describe("toProjectRelative", () => {
  it("computes posix relative path with forward slashes", () => {
    expect(toProjectRelative("/home/user/project", "/home/user/project/docs/guide.md")).toBe("docs/guide.md");
  });

  it("computes relative path from backslash absolute path", () => {
    expect(toProjectRelative("C:\\Users\\foo\\project", "C:\\Users\\foo\\project\\sub\\card.html")).toBe("sub/card.html");
  });

  it("throws when path is outside the project", () => {
    expect(() => toProjectRelative("/home/user/project", "/home/user/project-bak/x.md")).toThrow(
      /outside the project/,
    );
  });

  it("returns empty string when path equals the project root", () => {
    expect(toProjectRelative("/home/user/project", "/home/user/project")).toBe("");
  });

  it("preserves original filename case on windows", () => {
    expect(toProjectRelative("C:\\Users\\foo\\project", "C:\\Users\\Foo\\Project\\Card.HTML")).toBe("Card.HTML");
  });
});

describe("joinProjectPath", () => {
  it("joins posix root with segments", () => {
    expect(joinProjectPath("/home/user/project", "docs", "guide.md")).toBe("/home/user/project/docs/guide.md");
  });

  it("joins windows root with segments using forward slash", () => {
    expect(joinProjectPath("C:\\Users\\foo\\project", "untitled.html")).toBe("C:/Users/foo/project/untitled.html");
  });

  it("normalizes backslash segments", () => {
    expect(joinProjectPath("/home/user/project", "sub\\dir", "a.md")).toBe("/home/user/project/sub/dir/a.md");
  });
});
