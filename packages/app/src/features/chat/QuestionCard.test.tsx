import { fireEvent, render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { QuestionCardRenderer } from "./QuestionCard";
import type { QuestionCard } from "./types";

function renderCard(card: QuestionCard, onRespondQuestion?: (requestId: string, answer: string) => boolean | void) {
  render(<QuestionCardRenderer card={card} onRespondQuestion={onRespondQuestion} />);
}

function sendButton(): HTMLButtonElement {
  return screen.getByRole("button", { name: "发送" });
}

function optionButton(text: string): HTMLButtonElement {
  return screen.getByRole("button", { name: text });
}

function pendingCard(overrides?: Partial<QuestionCard>): QuestionCard {
  return { type: "question", status: "pending", question: "继续吗？", requestId: "req-1", ...overrides };
}

describe("QuestionCard", () => {
  it("renders the question text and an input in pending state", () => {
    renderCard(pendingCard());
    expect(screen.getByText("继续吗？")).toBeInTheDocument();
    expect(screen.getByRole("textbox")).toBeInTheDocument();
    expect(sendButton()).toBeInTheDocument();
  });

  it("renders the answer label and answer text without an input in answered state", () => {
    renderCard({ type: "question", status: "answered", question: "继续吗？", answer: "继续" });
    expect(screen.getByText("继续吗？")).toBeInTheDocument();
    expect(screen.getByText("你的回答")).toBeInTheDocument();
    expect(screen.getByText("继续")).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("renders the timeout label with the question and without an input in timeout state", () => {
    renderCard({ type: "question", status: "timeout", question: "继续吗？" });
    expect(screen.getByText("继续吗？")).toBeInTheDocument();
    expect(screen.getByText("未回答（等待超时）")).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("renders option buttons when options are present and absent otherwise", () => {
    const withOptions = render(
      <QuestionCardRenderer card={pendingCard({ options: ["继续", "停止"] })} />,
    );
    expect(screen.getByRole("button", { name: "继续" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "停止" })).toBeInTheDocument();
    withOptions.unmount();

    render(<QuestionCardRenderer card={pendingCard()} />);
    expect(screen.queryAllByRole("button").map((button) => button.textContent)).toEqual(["发送"]);
  });

  it("calls onRespondQuestion with (requestId, optionText) when an option is clicked", async () => {
    const user = userEvent.setup();
    const onRespondQuestion = vi.fn();
    renderCard(pendingCard({ options: ["继续", "停止"], requestId: "req-9" }), onRespondQuestion);
    await user.click(optionButton("停止"));
    expect(onRespondQuestion).toHaveBeenCalledWith("req-9", "停止");
  });

  it("disables the send button while the input is empty or whitespace-only", async () => {
    const user = userEvent.setup();
    renderCard(pendingCard());
    const input = screen.getByRole("textbox");
    expect(sendButton()).toBeDisabled();

    await user.type(input, "   ");
    expect(sendButton()).toBeDisabled();

    await user.clear(input);
    await user.type(input, "好的");
    expect(sendButton()).toBeEnabled();
  });

  it("submits the trimmed value via Enter key", async () => {
    const user = userEvent.setup();
    const onRespondQuestion = vi.fn();
    renderCard(pendingCard(), onRespondQuestion);
    await user.type(screen.getByRole("textbox"), "  好的  {Enter}");
    expect(onRespondQuestion).toHaveBeenCalledWith("req-1", "好的");
  });

  it("submits the trimmed value via the send button", async () => {
    const user = userEvent.setup();
    const onRespondQuestion = vi.fn();
    renderCard(pendingCard(), onRespondQuestion);
    await user.type(screen.getByRole("textbox"), "  好的  ");
    await user.click(sendButton());
    expect(onRespondQuestion).toHaveBeenCalledWith("req-1", "好的");
  });

  it("locks the input and buttons after submitting", async () => {
    const user = userEvent.setup();
    const onRespondQuestion = vi.fn();
    renderCard(pendingCard({ options: ["继续"] }), onRespondQuestion);
    const input = screen.getByRole("textbox");
    await user.type(input, "好的");
    await user.click(sendButton());
    expect(input).toBeDisabled();
    expect(sendButton()).toBeDisabled();
    expect(optionButton("继续")).toBeDisabled();

    fireEvent.keyDown(input, { key: "Enter", bubbles: true, cancelable: true });
    expect(onRespondQuestion).toHaveBeenCalledTimes(1);
  });

  it("locks option buttons after an option is clicked", async () => {
    const user = userEvent.setup();
    const onRespondQuestion = vi.fn();
    renderCard(pendingCard({ options: ["继续", "停止"] }), onRespondQuestion);
    await user.click(optionButton("继续"));
    expect(optionButton("继续")).toBeDisabled();
    expect(optionButton("停止")).toBeDisabled();
    expect(screen.getByRole("textbox")).toBeDisabled();
    expect(onRespondQuestion).toHaveBeenCalledTimes(1);
  });

  it("does not submit when Enter is pressed during IME composition", async () => {
    const user = userEvent.setup();
    const onRespondQuestion = vi.fn();
    renderCard(pendingCard(), onRespondQuestion);
    const input = screen.getByRole("textbox");
    await user.type(input, "好的");

    fireEvent.compositionStart(input);
    fireEvent.keyDown(input, { key: "Enter", bubbles: true, cancelable: true, isComposing: true });
    expect(onRespondQuestion).not.toHaveBeenCalled();

    fireEvent.keyDown(input, { key: "Enter", bubbles: true, cancelable: true, isComposing: false });
    expect(onRespondQuestion).not.toHaveBeenCalled();

    fireEvent.compositionEnd(input);
    fireEvent.keyDown(input, { key: "Enter", bubbles: true, cancelable: true });
    expect(onRespondQuestion).toHaveBeenCalledWith("req-1", "好的");
  });

  it("does not lock the input when delivery fails and allows retrying", async () => {
    const user = userEvent.setup();
    const onRespondQuestion = vi.fn(() => false);
    renderCard(pendingCard(), onRespondQuestion);
    const input = screen.getByRole("textbox");
    await user.type(input, "好的");
    await user.click(sendButton());
    expect(onRespondQuestion).toHaveBeenCalledTimes(1);
    expect(input).toBeEnabled();
    expect(sendButton()).toBeEnabled();

    await user.clear(input);
    await user.type(input, "再试一次");
    await user.click(sendButton());
    expect(onRespondQuestion).toHaveBeenCalledTimes(2);
    expect(onRespondQuestion).toHaveBeenLastCalledWith("req-1", "再试一次");
  });
});
