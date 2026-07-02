import { describe, expect, it } from "vitest";
import { resolveMarkdownImagePath } from "./image-path";

describe("resolveMarkdownImagePath", () => {
  it("resolves a same-directory relative path", () => {
    expect(resolveMarkdownImagePath("foo.png", "docs/article.md")).toBe("docs/foo.png");
  });

  it("resolves a subdirectory relative path", () => {
    expect(resolveMarkdownImagePath("images/foo.png", "docs/article.md")).toBe("docs/images/foo.png");
  });

  it("resolves ./ prefix relative to the markdown directory", () => {
    expect(resolveMarkdownImagePath("./images/foo.png", "docs/article.md")).toBe("docs/images/foo.png");
  });

  it("resolves ../ to the parent directory", () => {
    expect(resolveMarkdownImagePath("../shared/bar.png", "docs/chapter1/article.md")).toBe(
      "docs/shared/bar.png",
    );
  });

  it("treats a leading / as project-root-relative", () => {
    expect(resolveMarkdownImagePath("/assets/logo.svg", "docs/deep/nested/file.md")).toBe(
      "assets/logo.svg",
    );
  });

  it("returns absolute http URLs unchanged", () => {
    expect(resolveMarkdownImagePath("https://example.com/img.png", "docs/article.md")).toBe(
      "https://example.com/img.png",
    );
  });

  it("returns data URIs unchanged", () => {
    const dataUri = "data:image/png;base64,iVBORw0KGgo=";
    expect(resolveMarkdownImagePath(dataUri, "docs/article.md")).toBe(dataUri);
  });

  it("returns blob URLs unchanged", () => {
    expect(resolveMarkdownImagePath("blob:http://localhost/abc", "docs/article.md")).toBe(
      "blob:http://localhost/abc",
    );
  });

  it("handles a markdown file at project root (no directory)", () => {
    expect(resolveMarkdownImagePath("foo.png", "README.md")).toBe("foo.png");
  });

  it("collapses redundant ./ and // segments", () => {
    expect(resolveMarkdownImagePath("./a/./b.png", "docs/article.md")).toBe("docs/a/b.png");
  });

  it("returns empty string unchanged", () => {
    expect(resolveMarkdownImagePath("", "docs/article.md")).toBe("");
  });

  it("handles non-ASCII characters in paths", () => {
    expect(resolveMarkdownImagePath("图片/封面.png", "文档/文章.md")).toBe("文档/图片/封面.png");
  });

  it("handles spaces in file names", () => {
    expect(resolveMarkdownImagePath("my image.png", "docs/my article.md")).toBe(
      "docs/my image.png",
    );
  });
});
