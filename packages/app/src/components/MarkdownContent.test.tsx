import { act } from "react";
import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MarkdownContent } from "./MarkdownContent";

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot> | null = null;

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
});

afterEach(() => {
  if (root) {
    act(() => root!.unmount());
    root = null;
  }
  host.remove();
});

function render(children: string, plain?: boolean) {
  act(() => {
    root = createRoot(host);
    root.render(createElement(MarkdownContent, { variant: "chat", plain, children }));
  });
}

function html(): string {
  return host.innerHTML;
}

describe("MarkdownContent plain mode", () => {
  it("renders a single newline as <br>", () => {
    render("line one\nline two", true);
    expect(html()).toContain("<br");
  });

  it("keeps double newline as paragraph break", () => {
    render("para one\n\npara two", true);
    expect(host.querySelectorAll("p").length).toBe(2);
  });

  it("degrades headings, lists and emphasis to plain text without losing content", () => {
    render("# Title\n\n- item one\n- item two\n\n**bold** and *italic*", true);
    const rendered = html();
    expect(rendered).not.toContain("<h1");
    expect(rendered).not.toContain("<ul");
    expect(rendered).not.toContain("<strong");
    expect(rendered).not.toContain("<em");
    expect(rendered).toContain("Title");
    expect(rendered).toContain("item one");
    expect(rendered).toContain("item two");
    expect(rendered).toContain("bold");
    expect(rendered).toContain("italic");
  });

  it("keeps ordered list numbers and line breaks in plain mode", () => {
    render("1. test1\n2. test2", true);
    const rendered = html();
    expect(rendered).not.toContain("<ol");
    expect(rendered).not.toContain("<li");
    expect(rendered).toContain("1. test1");
    expect(rendered).toContain("2. test2");
    expect(rendered).toContain("<br");
  });

  it("keeps ordered list start number in plain mode", () => {
    render("3. alpha\n4. beta", true);
    expect(host.textContent).toContain("3. alpha");
    expect(host.textContent).toContain("4. beta");
  });

  it("keeps unordered list bullets in plain mode", () => {
    render("- item one\n- item two", true);
    expect(html()).not.toContain("<ul");
    expect(host.textContent).toContain("- item one");
    expect(host.textContent).toContain("- item two");
  });

  it("keeps inline links inside list items in plain mode", () => {
    render("1. see [docs](https://example.com)", true);
    const link = host.querySelector("a");
    expect(link?.getAttribute("href")).toBe("https://example.com");
    expect(link?.textContent).toBe("docs");
  });

  it("keeps task list markers in plain mode", () => {
    render("- [ ] todo\n- [x] done", true);
    expect(host.textContent).toContain("[ ] todo");
    expect(host.textContent).toContain("[x] done");
  });

  it("renders nested list items with indentation in plain mode", () => {
    render("- outer\n  - inner", true);
    expect(host.textContent).toContain("- outer");
    expect(host.textContent).toContain("\u00a0\u00a0- inner");
  });

  it("keeps list content inside a blockquote within a list item in plain mode", () => {
    render("1. a\n   > - x\n   > - y", true);
    expect(host.textContent).toContain("1. a");
    expect(host.textContent).toContain("- x");
    expect(host.textContent).toContain("- y");
  });

  it("keeps an empty list item marker in plain mode", () => {
    render("-\n- b", true);
    expect(html()).toContain("<br");
    expect(host.textContent).toContain("- b");
  });

  it("renders table rows as separated lines in plain mode", () => {
    render("| a | b |\n| --- | --- |\n| 1 | 2 |", true);
    const rendered = html();
    expect(rendered).not.toContain("<table");
    expect(rendered).toContain("<br");
    expect(host.textContent).toContain("a | b");
    expect(host.textContent).toContain("1 | 2");
  });

  it("renders thematic breaks as literal dashes in plain mode", () => {
    render("above\n\n---\n\nbelow", true);
    expect(html()).not.toContain("<hr");
    expect(host.textContent).toContain("---");
  });

  it("preserves blockquote rendering", () => {
    render("> quoted text", true);
    const quote = host.querySelector("blockquote[data-md-quote]");
    expect(quote?.textContent).toContain("quoted text");
  });

  it("preserves code block rendering", () => {
    render("```\nconst x = 1\n```", true);
    expect(html()).toContain("pre");
    expect(host.textContent).toContain("const x = 1");
  });

  it("preserves links including autolinks", () => {
    render("[docs](https://example.com) and https://example.org", true);
    const links = Array.from(host.querySelectorAll("a"));
    expect(links.map((a) => a.getAttribute("href"))).toEqual(
      expect.arrayContaining(["https://example.com", "https://example.org"]),
    );
    expect(host.textContent).toContain("docs");
  });
});

describe("MarkdownContent full markdown mode", () => {
  it("still renders headings, lists and emphasis when plain is not set", () => {
    render("# Title\n\n- item\n\n**bold**");
    const rendered = html();
    expect(rendered).toContain("<h1");
    expect(rendered).toContain("<ul");
    expect(rendered).toContain("<strong");
  });

  it("does not convert single newline to <br> outside plain mode", () => {
    render("line one\nline two");
    expect(html()).not.toContain("<br");
  });
});
