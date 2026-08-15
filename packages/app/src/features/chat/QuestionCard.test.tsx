import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QuestionCardRenderer } from "./QuestionCard";
import type { QuestionCard } from "./types";

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

function render(card: QuestionCard, onRespondQuestion?: (requestId: string, answer: string) => boolean | void) {
  act(() => {
    root = createRoot(host);
    root.render(<QuestionCardRenderer card={card} onRespondQuestion={onRespondQuestion} />);
  });
}

function buttons(): HTMLButtonElement[] {
  return Array.from(host.querySelectorAll("button"));
}

function sendButton(): HTMLButtonElement {
  return buttons().find((button) => button.textContent === "发送")!;
}

function optionButton(text: string): HTMLButtonElement {
  return buttons().find((button) => button.textContent === text)!;
}

function setInputValue(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
  setter.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function pressEnter(input: HTMLInputElement): void {
  input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
}

function pendingCard(overrides?: Partial<QuestionCard>): QuestionCard {
  return { type: "question", status: "pending", question: "继续吗？", requestId: "req-1", ...overrides };
}

describe("QuestionCard", () => {
  it("renders the question text and an input in pending state", () => {
    render(pendingCard());
    expect(host.textContent).toContain("继续吗？");
    expect(host.querySelector("input")).not.toBeNull();
    expect(sendButton()).toBeDefined();
  });

  it("renders the answer label and answer text without an input in answered state", () => {
    render({ type: "question", status: "answered", question: "继续吗？", answer: "继续" });
    expect(host.textContent).toContain("继续吗？");
    expect(host.textContent).toContain("你的回答");
    expect(host.textContent).toContain("继续");
    expect(host.querySelector("input")).toBeNull();
  });

  it("renders the timeout label with the question and without an input in timeout state", () => {
    render({ type: "question", status: "timeout", question: "继续吗？" });
    expect(host.textContent).toContain("继续吗？");
    expect(host.textContent).toContain("未回答（等待超时）");
    expect(host.querySelector("input")).toBeNull();
  });

  it("renders option buttons when options are present and absent otherwise", () => {
    render(pendingCard({ options: ["继续", "停止"] }));
    expect(optionButton("继续")).toBeDefined();
    expect(optionButton("停止")).toBeDefined();

    act(() => root!.unmount());
    render(pendingCard());
    expect(buttons().map((button) => button.textContent)).toEqual(["发送"]);
  });

  it("calls onRespondQuestion with (requestId, optionText) when an option is clicked", () => {
    const onRespondQuestion = vi.fn();
    render(pendingCard({ options: ["继续", "停止"], requestId: "req-9" }), onRespondQuestion);
    act(() => {
      optionButton("停止").click();
    });
    expect(onRespondQuestion).toHaveBeenCalledWith("req-9", "停止");
  });

  it("disables the send button while the input is empty or whitespace-only", () => {
    render(pendingCard());
    expect(sendButton().hasAttribute("disabled")).toBe(true);

    const input = host.querySelector("input")! as HTMLInputElement;
    act(() => {
      setInputValue(input, "   ");
    });
    expect(sendButton().hasAttribute("disabled")).toBe(true);

    act(() => {
      setInputValue(input, "好的");
    });
    expect(sendButton().hasAttribute("disabled")).toBe(false);
  });

  it("submits the trimmed value via Enter key", () => {
    const onRespondQuestion = vi.fn();
    render(pendingCard(), onRespondQuestion);
    const input = host.querySelector("input")! as HTMLInputElement;
    act(() => {
      setInputValue(input, "  好的  ");
    });
    act(() => {
      pressEnter(input);
    });
    expect(onRespondQuestion).toHaveBeenCalledWith("req-1", "好的");
  });

  it("submits the trimmed value via the send button", () => {
    const onRespondQuestion = vi.fn();
    render(pendingCard(), onRespondQuestion);
    const input = host.querySelector("input")! as HTMLInputElement;
    act(() => {
      setInputValue(input, "  好的  ");
    });
    act(() => {
      sendButton().click();
    });
    expect(onRespondQuestion).toHaveBeenCalledWith("req-1", "好的");
  });

  it("locks the input and buttons after submitting", () => {
    const onRespondQuestion = vi.fn();
    render(pendingCard({ options: ["继续"] }), onRespondQuestion);
    const input = host.querySelector("input")! as HTMLInputElement;
    act(() => {
      setInputValue(input, "好的");
    });
    act(() => {
      sendButton().click();
    });
    expect(input.hasAttribute("disabled")).toBe(true);
    expect(sendButton().hasAttribute("disabled")).toBe(true);
    expect(optionButton("继续").hasAttribute("disabled")).toBe(true);

    act(() => {
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    });
    expect(onRespondQuestion).toHaveBeenCalledTimes(1);
  });

  it("locks option buttons after an option is clicked", () => {
    const onRespondQuestion = vi.fn();
    render(pendingCard({ options: ["继续", "停止"] }), onRespondQuestion);
    act(() => {
      optionButton("继续").click();
    });
    expect(optionButton("继续").hasAttribute("disabled")).toBe(true);
    expect(optionButton("停止").hasAttribute("disabled")).toBe(true);
    expect(host.querySelector("input")!.hasAttribute("disabled")).toBe(true);
    expect(onRespondQuestion).toHaveBeenCalledTimes(1);
  });

  it("does not submit when Enter is pressed during IME composition", () => {
    const onRespondQuestion = vi.fn();
    render(pendingCard(), onRespondQuestion);
    const input = host.querySelector("input")! as HTMLInputElement;
    act(() => {
      setInputValue(input, "好的");
    });
    act(() => {
      input.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
    });
    act(() => {
      input.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true, isComposing: true }),
      );
    });
    expect(onRespondQuestion).not.toHaveBeenCalled();
    act(() => {
      input.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true, isComposing: false }),
      );
    });
    expect(onRespondQuestion).not.toHaveBeenCalled();
    act(() => {
      input.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true }));
    });
    act(() => {
      pressEnter(input);
    });
    expect(onRespondQuestion).toHaveBeenCalledWith("req-1", "好的");
  });

  it("does not lock the input when delivery fails and allows retrying", () => {
    const onRespondQuestion = vi.fn(() => false);
    render(pendingCard(), onRespondQuestion);
    const input = host.querySelector("input")! as HTMLInputElement;
    act(() => {
      setInputValue(input, "好的");
    });
    act(() => {
      sendButton().click();
    });
    expect(onRespondQuestion).toHaveBeenCalledTimes(1);
    expect(input.hasAttribute("disabled")).toBe(false);
    expect(sendButton().hasAttribute("disabled")).toBe(false);
    act(() => {
      setInputValue(input, "再试一次");
    });
    act(() => {
      sendButton().click();
    });
    expect(onRespondQuestion).toHaveBeenCalledTimes(2);
    expect(onRespondQuestion).toHaveBeenLastCalledWith("req-1", "再试一次");
  });
});
