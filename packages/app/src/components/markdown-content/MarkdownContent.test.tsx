import { render } from "@testing-library/react";
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { MarkdownContent } from "./MarkdownContent";

function renderMd(children: string, plain?: boolean) {
  const view = render(createElement(MarkdownContent, { variant: "chat", plain, children }));
  return {
    container: view.container,
    html: () => view.container.innerHTML,
    text: () => view.container.textContent ?? "",
  };
}

describe("MarkdownContent plain mode", () => {
  it("renders a single newline as <br>", () => {
    const md = renderMd("line one\nline two", true);
    expect(md.html()).toContain("<br");
  });

  it("keeps double newline as paragraph break", () => {
    const md = renderMd("para one\n\npara two", true);
    expect(md.container.querySelectorAll("p").length).toBe(2);
  });

  it("degrades headings, lists and emphasis to plain text without losing content", () => {
    const md = renderMd("# Title\n\n- item one\n- item two\n\n**bold** and *italic*", true);
    expect(md.html()).not.toContain("<h1");
    expect(md.html()).not.toContain("<ul");
    expect(md.html()).not.toContain("<strong");
    expect(md.html()).not.toContain("<em");
    expect(md.text()).toContain("Title");
    expect(md.text()).toContain("item one");
    expect(md.text()).toContain("item two");
    expect(md.text()).toContain("bold");
    expect(md.text()).toContain("italic");
  });

  it("keeps ordered list numbers and line breaks in plain mode", () => {
    const md = renderMd("1. test1\n2. test2", true);
    expect(md.html()).not.toContain("<ol");
    expect(md.html()).not.toContain("<li");
    expect(md.text()).toContain("1. test1");
    expect(md.text()).toContain("2. test2");
    expect(md.html()).toContain("<br");
  });

  it("keeps ordered list start number in plain mode", () => {
    const md = renderMd("3. alpha\n4. beta", true);
    expect(md.text()).toContain("3. alpha");
    expect(md.text()).toContain("4. beta");
  });

  it("keeps unordered list bullets in plain mode", () => {
    const md = renderMd("- item one\n- item two", true);
    expect(md.html()).not.toContain("<ul");
    expect(md.text()).toContain("- item one");
    expect(md.text()).toContain("- item two");
  });

  it("keeps inline links inside list items in plain mode", () => {
    const md = renderMd("1. see [docs](https://example.com)", true);
    const link = md.container.querySelector("a");
    expect(link?.getAttribute("href")).toBe("https://example.com");
    expect(link?.textContent).toBe("docs");
  });

  it("keeps task list markers in plain mode", () => {
    const md = renderMd("- [ ] todo\n- [x] done", true);
    expect(md.text()).toContain("[ ] todo");
    expect(md.text()).toContain("[x] done");
  });

  it("renders nested list items with indentation in plain mode", () => {
    const md = renderMd("- outer\n  - inner", true);
    expect(md.text()).toContain("- outer");
    expect(md.text()).toContain("\u00a0\u00a0- inner");
  });

  it("keeps list content inside a blockquote within a list item in plain mode", () => {
    const md = renderMd("1. a\n   > - x\n   > - y", true);
    expect(md.text()).toContain("1. a");
    expect(md.text()).toContain("- x");
    expect(md.text()).toContain("- y");
  });

  it("keeps an empty list item marker in plain mode", () => {
    const md = renderMd("-\n- b", true);
    expect(md.html()).toContain("<br");
    expect(md.text()).toContain("- b");
  });

  it("renders table rows as separated lines in plain mode", () => {
    const md = renderMd("| a | b |\n| --- | --- |\n| 1 | 2 |", true);
    expect(md.html()).not.toContain("<table");
    expect(md.html()).toContain("<br");
    expect(md.text()).toContain("a | b");
    expect(md.text()).toContain("1 | 2");
  });

  it("renders thematic breaks as literal dashes in plain mode", () => {
    const md = renderMd("above\n\n---\n\nbelow", true);
    expect(md.html()).not.toContain("<hr");
    expect(md.text()).toContain("---");
  });

  it("preserves blockquote rendering", () => {
    const md = renderMd("> quoted text", true);
    const quote = md.container.querySelector("blockquote[data-md-quote]");
    expect(quote?.textContent).toContain("quoted text");
  });

  it("preserves code block rendering", () => {
    const md = renderMd("```\nconst x = 1\n```", true);
    expect(md.html()).toContain("pre");
    expect(md.text()).toContain("const x = 1");
  });

  it("preserves links including autolinks", () => {
    const md = renderMd("[docs](https://example.com) and https://example.org", true);
    const links = Array.from(md.container.querySelectorAll("a"));
    expect(links.map((a) => a.getAttribute("href"))).toEqual(
      expect.arrayContaining(["https://example.com", "https://example.org"]),
    );
    expect(md.text()).toContain("docs");
  });
});

describe("MarkdownContent full markdown mode", () => {
  it("still renders headings, lists and emphasis when plain is not set", () => {
    const md = renderMd("# Title\n\n- item\n\n**bold**");
    expect(md.html()).toContain("<h1");
    expect(md.html()).toContain("<ul");
    expect(md.html()).toContain("<strong");
  });

  it("does not convert single newline to <br> outside plain mode", () => {
    const md = renderMd("line one\nline two");
    expect(md.html()).not.toContain("<br");
  });
});
