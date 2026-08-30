import { act, render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { createElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CodeBlock } from "./CodeBlock";

let user: ReturnType<typeof userEvent.setup>;
let writeText: ReturnType<typeof vi.fn>;

function setClipboard(value: { writeText?: unknown } | undefined) {
  Object.defineProperty(navigator, "clipboard", { value, configurable: true, writable: true });
}

beforeEach(() => {
  user = userEvent.setup();
  writeText = vi.fn().mockResolvedValue(undefined);
  setClipboard({ writeText });
});

afterEach(() => {
  vi.useRealTimers();
});

function renderCode(children: ReactNode) {
  return render(<CodeBlock className="mb-3">{children}</CodeBlock>);
}

function copyButton(): HTMLButtonElement {
  return screen.getByRole("button", { name: "复制代码" });
}

describe("CodeBlock", () => {
  it("renders data-md-code on the inner pre and keeps the code text", () => {
    const { container } = renderCode(createElement("code", { className: "language-js" }, "const x = 1;\n"));
    const pre = container.querySelector("pre[data-md-code]")!;
    expect(pre).not.toBeNull();
    expect(pre.textContent).toContain("const x = 1;");
    expect(container.querySelector("div.group.relative")).not.toBeNull();
  });

  it("renders a copy button with the copy-code accessible label", () => {
    renderCode("code text");
    expect(copyButton()).toHaveAttribute("title", "复制代码");
  });

  it("copies the extracted code text to the clipboard on click", async () => {
    renderCode(createElement("code", null, "console.log(1);\n"));
    await user.click(copyButton());
    expect(writeText).toHaveBeenCalledWith("console.log(1);\n");
  });

  it("swaps to a check icon after a successful copy and resets after 2s", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    user = userEvent.setup();
    renderCode(createElement("code", null, "hello"));

    await user.click(copyButton());
    expect(copyButton().querySelector("svg.lucide-check")).not.toBeNull();
    expect(copyButton().querySelector("svg.lucide-copy")).toBeNull();

    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(copyButton().querySelector("svg.lucide-check")).toBeNull();
    expect(copyButton().querySelector("svg.lucide-copy")).not.toBeNull();
  });

  it("does not throw when the clipboard is unavailable", async () => {
    setClipboard(undefined);
    renderCode("text");
    await user.click(copyButton());
    expect(writeText).not.toHaveBeenCalled();
  });
});
