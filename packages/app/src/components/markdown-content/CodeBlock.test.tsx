import { act } from "react";
import { createElement, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CodeBlock } from "./CodeBlock";

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot> | null = null;
let writeText: ReturnType<typeof vi.fn>;

function setClipboard(value: { writeText?: unknown } | undefined) {
  Object.defineProperty(navigator, "clipboard", { value, configurable: true, writable: true });
}

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  writeText = vi.fn().mockResolvedValue(undefined);
  setClipboard({ writeText });
});

afterEach(() => {
  if (root) {
    act(() => root!.unmount());
    root = null;
  }
  host.remove();
});

function render(children: ReactNode) {
  act(() => {
    root = createRoot(host);
    root.render(<CodeBlock className="mb-3">{children}</CodeBlock>);
  });
}

function pre(): HTMLPreElement {
  return host.querySelector("pre[data-md-code]")!;
}

function copyButton(): HTMLButtonElement {
  return host.querySelector("button[aria-label]")!;
}

describe("CodeBlock", () => {
  it("renders data-md-code on the inner pre and keeps the code text", () => {
    render(createElement("code", { className: "language-js" }, "const x = 1;\n"));
    expect(pre()).not.toBeNull();
    expect(pre().textContent).toContain("const x = 1;");
    expect(host.querySelector("div.group.relative")).not.toBeNull();
  });

  it("renders a copy button with the copy-code accessible label", () => {
    render("code text");
    expect(copyButton()).toBeDefined();
    expect(copyButton().getAttribute("aria-label")).toBe("复制代码");
    expect(copyButton().getAttribute("title")).toBe("复制代码");
  });

  it("copies the extracted code text to the clipboard on click", async () => {
    render(createElement("code", null, "console.log(1);\n"));
    await act(async () => {
      copyButton().click();
    });
    expect(writeText).toHaveBeenCalledWith("console.log(1);\n");
  });

  it("swaps to a check icon after a successful copy and resets after 2s", async () => {
    render(createElement("code", null, "hello"));
    vi.useFakeTimers();
    try {
      await act(async () => {
        copyButton().click();
      });
      expect(host.querySelector("button svg.lucide-check")).not.toBeNull();
      expect(host.querySelector("button svg.lucide-copy")).toBeNull();

      act(() => {
        vi.advanceTimersByTime(2000);
      });
      expect(host.querySelector("button svg.lucide-check")).toBeNull();
      expect(host.querySelector("button svg.lucide-copy")).not.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not throw when the clipboard is unavailable", () => {
    setClipboard(undefined);
    render("text");
    expect(() => {
      act(() => {
        copyButton().click();
      });
    }).not.toThrow();
    expect(writeText).not.toHaveBeenCalled();
  });
});
