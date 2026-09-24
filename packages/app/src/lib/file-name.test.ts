import { describe, expect, it } from "vitest";
import { fileBasename, fileDisplayName } from "./file-name";

describe("file-name", () => {
  it("returns the last path segment", () => {
    expect(fileBasename("notes/sub/a.md")).toBe("a.md");
    expect(fileBasename("notes/")).toBe("notes");
  });

  it("drops the extension but keeps dotfiles and extensionless names", () => {
    expect(fileDisplayName("notes/a.md")).toBe("a");
    expect(fileDisplayName("site/index.html")).toBe("index");
    expect(fileDisplayName("archive.tar.gz")).toBe("archive.tar");
    expect(fileDisplayName(".gitignore")).toBe(".gitignore");
    expect(fileDisplayName("Makefile")).toBe("Makefile");
  });
});
