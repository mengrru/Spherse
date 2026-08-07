import { describe, expect, it } from "vitest";
import { classifyFileKind } from "./file-kind";

describe("classifyFileKind", () => {
  it("classifies markdown extensions", () => {
    expect(classifyFileKind("readme.md")).toEqual({ isMarkdown: true, isHtml: false, isImage: false });
    expect(classifyFileKind("readme.markdown")).toEqual({ isMarkdown: true, isHtml: false, isImage: false });
    expect(classifyFileKind(".agents.md")).toEqual({ isMarkdown: true, isHtml: false, isImage: false });
    expect(classifyFileKind("a/b.agents.md")).toEqual({ isMarkdown: true, isHtml: false, isImage: false });
  });

  it("classifies html extensions", () => {
    expect(classifyFileKind("page.html")).toEqual({ isMarkdown: false, isHtml: true, isImage: false });
    expect(classifyFileKind("page.htm")).toEqual({ isMarkdown: false, isHtml: true, isImage: false });
  });

  it("classifies image extensions including ico", () => {
    expect(classifyFileKind("pic.png")).toEqual({ isMarkdown: false, isHtml: false, isImage: true });
    expect(classifyFileKind("a/b/c.JPG")).toEqual({ isMarkdown: false, isHtml: false, isImage: true });
    expect(classifyFileKind("favicon.ico")).toEqual({ isMarkdown: false, isHtml: false, isImage: true });
    expect(classifyFileKind("logo.webp")).toEqual({ isMarkdown: false, isHtml: false, isImage: true });
  });

  it("treats unknown extensions, dotfiles and extensionless files as other", () => {
    expect(classifyFileKind("archive.zip")).toEqual({ isMarkdown: false, isHtml: false, isImage: false });
    expect(classifyFileKind("doc.pdf")).toEqual({ isMarkdown: false, isHtml: false, isImage: false });
    expect(classifyFileKind("Makefile")).toEqual({ isMarkdown: false, isHtml: false, isImage: false });
    expect(classifyFileKind(".gitignore")).toEqual({ isMarkdown: false, isHtml: false, isImage: false });
    expect(classifyFileKind("LICENSE")).toEqual({ isMarkdown: false, isHtml: false, isImage: false });
  });
});
