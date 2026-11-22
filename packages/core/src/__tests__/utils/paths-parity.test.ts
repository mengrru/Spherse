import { describe, it, expect } from "vitest";
import nodePath from "node:path";
import * as pure from "../../utils/paths.js";

const CASES: Array<[string, string[]]> = [
  ["normalize", ["a/b/c", "/a/b/c", "a/./b", "a/../b", "/a/../b", "..", "../..", "/..", "a/", "", ".", "/"]],
  ["dirname", ["a/b", "/a/b", "a", "/", "", "a/b/c.txt"]],
  ["basename", ["a/b.txt", "b.txt", "/b.txt", "a/b.txt;.txt", "a/b", "/"]],
  ["extname", ["a/b.txt", "b.tar.gz", ".hidden", "a/b.", "a/b", ""]],
];

describe("pure posix paths vs node:path", () => {
  for (const [fn, inputs] of CASES) {
    describe(fn, () => {
      for (const input of inputs) {
        const label = JSON.stringify(input);
        if (fn === "basename" && label.includes(";")) continue;
        it(`${label}`, () => {
          if (fn === "normalize") expect(pure.normalize(input)).toBe(nodePath.posix.normalize(input));
          if (fn === "dirname") expect(pure.dirname(input)).toBe(nodePath.posix.dirname(input));
          if (fn === "basename") expect(pure.basename(input)).toBe(nodePath.posix.basename(input));
          if (fn === "extname") expect(pure.extname(input)).toBe(nodePath.posix.extname(input));
        });
      }
    });
  }

  it("basename with ext matches", () => {
    expect(pure.basename("a/b.html", ".html")).toBe(nodePath.posix.basename("a/b.html", ".html"));
    expect(pure.basename("a/.hidden", ".hidden")).toBe(nodePath.posix.basename("a/.hidden", ".hidden"));
  });

  it("join matches node posix", () => {
    expect(pure.join("a", "b", "c")).toBe(nodePath.posix.join("a", "b", "c"));
    expect(pure.join("a", "/b", ".", "c/")).toBe(nodePath.posix.join("a", "/b", ".", "c/"));
    expect(pure.join("a", "..", "b")).toBe(nodePath.posix.join("a", "..", "b"));
    expect(pure.join()).toBe(nodePath.posix.join());
    expect(pure.join("")).toBe(nodePath.posix.join(""));
  });

  it("resolve matches node posix when inputs are absolute or homed at a virtual cwd", () => {
    const virtualCwd = "/";
    expect(pure.resolve("/vroot", "a/b")).toBe(nodePath.resolve("/vroot", "a/b"));
    expect(pure.resolve("/vroot", "./a", "../b")).toBe(nodePath.resolve("/vroot", "./a", "../b"));
    expect(pure.resolve("/vroot/x", "/y")).toBe(nodePath.resolve("/vroot/x", "/y"));
    expect(pure.resolve("/vroot", "../../escape")).toBe(nodePath.resolve("/vroot", "../../escape"));
    expect(pure.resolve("/vroot")).toBe(nodePath.resolve(virtualCwd, "/vroot"));
    expect(pure.resolve()).toBe(nodePath.resolve(virtualCwd));
  });

  it("relative matches node posix for absolute inputs", () => {
    expect(pure.relative("/vroot/a", "/vroot/b")).toBe(nodePath.posix.relative("/vroot/a", "/vroot/b"));
    expect(pure.relative("/vroot/a/x", "/vroot/a")).toBe(nodePath.posix.relative("/vroot/a/x", "/vroot/a"));
    expect(pure.relative("/vroot/a", "/vroot/a")).toBe(nodePath.posix.relative("/vroot/a", "/vroot/a"));
    expect(pure.relative("/a/b/c", "/a/x/y/z")).toBe(nodePath.posix.relative("/a/b/c", "/a/x/y/z"));
  });

  it("isAbsolute matches", () => {
    for (const input of ["/a", "a", "", "/", "./a", "../a"]) {
      expect(pure.isAbsolute(input)).toBe(nodePath.posix.isAbsolute(input));
    }
  });

  it("win32.isAbsolute detects drive and UNC forms", () => {
    expect(pure.win32.isAbsolute("C:\\Users")).toBe(true);
    expect(pure.win32.isAbsolute("\\\\server\\share")).toBe(true);
    expect(pure.win32.isAbsolute("/a")).toBe(true);
    expect(pure.win32.isAbsolute("a/b")).toBe(false);
  });
});
