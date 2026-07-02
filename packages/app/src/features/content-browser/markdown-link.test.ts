import { describe, expect, it } from "vitest";
import { isExternalUrl, resolveMarkdownLink } from "./markdown-link";

describe("isExternalUrl", () => {
  it("returns true for http(s) URLs", () => {
    expect(isExternalUrl("https://example.com")).toBe(true);
    expect(isExternalUrl("http://example.com/path")).toBe(true);
  });

  it("returns true for mailto/tel/data/blob/file URLs", () => {
    expect(isExternalUrl("mailto:foo@bar.com")).toBe(true);
    expect(isExternalUrl("tel:+1234567890")).toBe(true);
    expect(isExternalUrl("data:image/png;base64,iVBORw0KGgo=")).toBe(true);
    expect(isExternalUrl("blob:http://localhost/abc")).toBe(true);
    expect(isExternalUrl("file:///etc/passwd")).toBe(true);
  });

  it("returns false for project-relative paths", () => {
    expect(isExternalUrl("./other.md")).toBe(false);
    expect(isExternalUrl("/assets/x.png")).toBe(false);
    expect(isExternalUrl("../up.md")).toBe(false);
    expect(isExternalUrl("#anchor")).toBe(false);
  });
});

describe("resolveMarkdownLink", () => {
  it("classifies external http URLs", () => {
    expect(resolveMarkdownLink("https://example.com", "docs/article.md")).toEqual({
      kind: "external",
    });
  });

  it("classifies mailto links as external", () => {
    expect(resolveMarkdownLink("mailto:foo@bar.com", "docs/article.md")).toEqual({
      kind: "external",
    });
  });

  it("classifies a pure anchor as same-file anchor", () => {
    expect(resolveMarkdownLink("#section", "docs/article.md")).toEqual({
      kind: "anchor",
      anchor: "section",
    });
  });

  it("decodes encoded anchor fragments", () => {
    expect(resolveMarkdownLink("#%E4%B8%AD%E6%96%87", "docs/article.md")).toEqual({
      kind: "anchor",
      anchor: "中文",
    });
  });

  it("resolves a same-directory relative markdown link", () => {
    expect(resolveMarkdownLink("other.md", "docs/article.md")).toEqual({
      kind: "internal",
      path: "docs/other.md",
    });
  });

  it("resolves ./ prefix relative to the markdown directory", () => {
    expect(resolveMarkdownLink("./intro.md", "docs/article.md")).toEqual({
      kind: "internal",
      path: "docs/intro.md",
    });
  });

  it("resolves ../ to the parent directory", () => {
    expect(resolveMarkdownLink("../shared/notes.md", "docs/chapter1/article.md")).toEqual({
      kind: "internal",
      path: "docs/shared/notes.md",
    });
  });

  it("treats a leading / as project-root-relative", () => {
    expect(resolveMarkdownLink("/assets/diagram.png", "docs/deep/nested/file.md")).toEqual({
      kind: "internal",
      path: "assets/diagram.png",
    });
  });

  it("splits a cross-file anchor from the path", () => {
    expect(resolveMarkdownLink("./other.md#section", "docs/article.md")).toEqual({
      kind: "internal",
      path: "docs/other.md",
      anchor: "section",
    });
  });

  it("splits a project-root-relative link with anchor", () => {
    expect(resolveMarkdownLink("/readme.md#top", "docs/article.md")).toEqual({
      kind: "internal",
      path: "readme.md",
      anchor: "top",
    });
  });

  it("handles a markdown file at project root (no directory)", () => {
    expect(resolveMarkdownLink("other.md", "README.md")).toEqual({
      kind: "internal",
      path: "other.md",
    });
  });

  it("collapses redundant ./ and // segments", () => {
    expect(resolveMarkdownLink("./a/./b.md", "docs/article.md")).toEqual({
      kind: "internal",
      path: "docs/a/b.md",
    });
  });

  it("returns empty path for empty href", () => {
    expect(resolveMarkdownLink("", "docs/article.md")).toEqual({
      kind: "internal",
      path: "",
    });
  });

  it("handles non-ASCII characters in paths", () => {
    expect(resolveMarkdownLink("章节/简介.md", "文档/文章.md")).toEqual({
      kind: "internal",
      path: "文档/章节/简介.md",
    });
  });

  it("decodes percent-encoded non-ASCII paths (as react-markdown passes them)", () => {
    expect(resolveMarkdownLink("../%E4%BA%BA%E7%89%A9/%E5%AF%BB%E5%BD%B1.md", "docs/文章.md")).toEqual({
      kind: "internal",
      path: "人物/寻影.md",
    });
  });

  it("decodes percent-encoded absolute-project paths", () => {
    expect(resolveMarkdownLink("/%E6%96%87%E6%A1%A3/%E7%AE%80%E4%BB%8B.md", "x.md")).toEqual({
      kind: "internal",
      path: "文档/简介.md",
    });
  });

  it("decodes percent-encoded path with cross-file anchor", () => {
    expect(resolveMarkdownLink("../%E4%BA%BA%E7%89%A9/%E5%AF%BB%E5%BD%B1.md#section", "docs/文章.md")).toEqual({
      kind: "internal",
      path: "人物/寻影.md",
      anchor: "section",
    });
  });

  it("tolerates malformed percent-encoding without throwing", () => {
    expect(resolveMarkdownLink("%E4%BD", "docs/article.md")).toEqual({
      kind: "internal",
      path: "docs/%E4%BD",
    });
  });

  it("handles spaces in file names", () => {
    expect(resolveMarkdownLink("my notes.md", "docs/my article.md")).toEqual({
      kind: "internal",
      path: "docs/my notes.md",
    });
  });

  it("does not treat a relative link with hash-only path as internal with path", () => {
    expect(resolveMarkdownLink("#", "docs/article.md")).toEqual({
      kind: "anchor",
      anchor: "",
    });
  });
});
