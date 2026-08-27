import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  app: { isPackaged: false },
}));

import { parseShellPathOutput, mergePath, fixPath } from "./fix-path.js";

describe("parseShellPathOutput", () => {
  it("returns PATH entries from a clean single-line output", () => {
    expect(parseShellPathOutput("/usr/local/bin:/usr/bin:/bin")).toEqual([
      "/usr/local/bin",
      "/usr/bin",
      "/bin",
    ]);
  });

  it("takes the last non-empty line (ignores shell banner / nvm noise before)", () => {
    const raw = "nvm: loaded\npyenv: initialized\n/opt/homebrew/bin:/usr/local/bin:/usr/bin";
    expect(parseShellPathOutput(raw)).toEqual([
      "/opt/homebrew/bin",
      "/usr/local/bin",
      "/usr/bin",
    ]);
  });

  it("strips ANSI escape sequences and control bytes", () => {
    const raw = "\x1b[1;32m/opt/homebrew/bin\x1b[0m:\x07/usr/bin";
    expect(parseShellPathOutput(raw)).toEqual(["/opt/homebrew/bin", "/usr/bin"]);
  });

  it("filters out empty segments", () => {
    expect(parseShellPathOutput("/usr/bin::/bin:")).toEqual(["/usr/bin", "/bin"]);
  });

  it("returns [] for empty / whitespace-only output", () => {
    expect(parseShellPathOutput("")).toEqual([]);
    expect(parseShellPathOutput("   \n  \n")).toEqual([]);
  });

  it("handles CRLF line endings", () => {
    expect(parseShellPathOutput("/a:/b\r\n/c\r\n")).toEqual(["/c"]);
  });
});

describe("mergePath", () => {
  it("prepends shell entries before current entries", () => {
    expect(mergePath(["/opt/homebrew/bin"], "/usr/bin:/bin")).toBe(
      "/opt/homebrew/bin:/usr/bin:/bin",
    );
  });

  it("dedups entries preserving first-seen order", () => {
    expect(mergePath(["/usr/bin", "/opt/homebrew/bin"], "/usr/bin:/usr/local/bin")).toBe(
      "/usr/bin:/opt/homebrew/bin:/usr/local/bin",
    );
  });

  it("is idempotent (merging the same entries twice yields the same result)", () => {
    const shell = ["/opt/homebrew/bin", "/usr/local/bin"];
    const once = mergePath(shell, "/usr/bin:/bin");
    const twice = mergePath(shell, once);
    expect(twice).toBe(once);
  });

  it("handles undefined current PATH", () => {
    expect(mergePath(["/a", "/b"], undefined)).toBe("/a:/b");
  });

  it("returns empty string for no entries", () => {
    expect(mergePath([], "")).toBe("");
  });
});

describe("fixPath", () => {
  it("is a no-op when app is not packaged (does not touch PATH)", async () => {
    const before = process.env.PATH;
    await fixPath();
    expect(process.env.PATH).toBe(before);
  });
});
