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
