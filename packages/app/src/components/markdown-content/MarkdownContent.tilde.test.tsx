import { render } from "@testing-library/react";
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { MarkdownContent } from "./MarkdownContent";

function renderMd(children: string, options: { plain?: boolean; variant?: "chat" | "document" } = {}) {
  const view = render(
    createElement(MarkdownContent, { variant: options.variant ?? "chat", plain: options.plain, children }),
  );
  return {
    container: view.container,
    html: () => view.container.innerHTML,
    text: () => view.container.textContent ?? "",
  };
}

describe("MarkdownContent chat variant single-tilde handling", () => {
  it("keeps single-tilde wrapped text literal without strikethrough", () => {
    const md = renderMd("内容A~内容B，内容C~内容D");
    expect(md.html()).not.toContain("<del");
    expect(md.text()).toContain("内容A~内容B，内容C~内容D");
  });

  it("keeps an unpaired single tilde literal", () => {
    const md = renderMd("约 ~10 个");
    expect(md.html()).not.toContain("<del");
    expect(md.text()).toContain("约 ~10 个");
  });

  it("still renders double tilde as strikethrough", () => {
    const md = renderMd("前置~~删除线~~后置");
    const del = md.container.querySelector("del");
    expect(del?.textContent).toBe("删除线");
    expect(md.text()).toContain("前置");
    expect(md.text()).toContain("后置");
  });

  it("keeps an escaped tilde literal without the backslash", () => {
    const md = renderMd("\\~内容~");
    expect(md.html()).not.toContain("<del");
    expect(md.text()).toContain("~内容~");
    expect(md.text()).not.toContain("\\~");
  });

  it("keeps tildes inside inline code spans literal", () => {
    const md = renderMd("配置 `a~b` 与 `c~d` 即可");
    expect(md.html()).not.toContain("<del");
    const codes = Array.from(md.container.querySelectorAll("code")).map((n) => n.textContent);
    expect(codes).toContain("a~b");
    expect(codes).toContain("c~d");
  });

  it("keeps tilde lines inside fenced code blocks untouched", () => {
    const md = renderMd("```\nrm -rf ~/*\necho ~done~\n```");
    expect(md.html()).not.toContain("<del");
    expect(md.text()).toContain("rm -rf ~/*");
    expect(md.text()).toContain("echo ~done~");
  });

  it("keeps tildes inside link destinations", () => {
    const md = renderMd("[文档](https://example.com/a~b)");
    expect(md.html()).not.toContain("<del");
    expect(md.container.querySelector("a")?.getAttribute("href")).toBe("https://example.com/a~b");
  });

  it("renders mixed single and double tildes independently", () => {
    const md = renderMd("a ~b~ and ~~c~~");
    const dels = Array.from(md.container.querySelectorAll("del")).map((n) => n.textContent);
    expect(dels).toEqual(["c"]);
    expect(md.text()).toContain("a ~b~ and ");
  });
});

describe("MarkdownContent document variant keeps GFM strikethrough", () => {
  it("still renders single-tilde strikethrough", () => {
    const md = renderMd("内容A~内容B~内容C", { variant: "document" });
    expect(md.container.querySelector("del")?.textContent).toBe("内容B");
  });

  it("still renders double-tilde strikethrough", () => {
    const md = renderMd("~~struck~~", { variant: "document" });
    expect(md.container.querySelector("del")?.textContent).toBe("struck");
  });
});

describe("MarkdownContent plain mode tilde semantics unchanged", () => {
  it("degrades double-tilde strikethrough to plain text without markers", () => {
    const md = renderMd("前置~~删除线~~后置", { plain: true });
    expect(md.html()).not.toContain("<del");
    expect(md.text()).toContain("前置删除线后置");
  });

  it("keeps existing plain degradation of single-tilde pairs", () => {
    const md = renderMd("内容A~内容B，内容C~内容D", { plain: true });
    expect(md.html()).not.toContain("<del");
    expect(md.text()).toContain("内容A内容B，内容C内容D");
  });

  it("keeps intraword underscores literal in plain mode", () => {
    const md = renderMd("内容A_内容B，内容C_内容D", { plain: true });
    expect(md.html()).not.toContain("<em");
    expect(md.text()).toContain("内容A_内容B，内容C_内容D");
  });
});
