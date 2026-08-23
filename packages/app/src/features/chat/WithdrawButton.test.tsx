import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProjectProvider } from "../../context/project-context";
import { WithdrawButton } from "./WithdrawButton";

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot> | null = null;

beforeEach(() => {
  vi.useFakeTimers();
  host = document.createElement("div");
  document.body.appendChild(host);
});

afterEach(() => {
  if (root) {
    act(() => root!.unmount());
    root = null;
  }
  host.remove();
  vi.useRealTimers();
});

function renderWithdrawButton() {
  const onWithdraw = vi.fn();
  act(() => {
    root = createRoot(host);
    root.render(
      <ProjectProvider projectId="p1" projectRoot="/tmp/p1">
        <WithdrawButton onWithdraw={onWithdraw} />
      </ProjectProvider>,
    );
  });
  return {
    onWithdraw,
    arm: () => host.querySelector<HTMLButtonElement>("[data-chat-withdraw]")!,
    confirm: () => host.querySelector<HTMLButtonElement>("[data-chat-withdraw-confirm]")!,
    cancel: () => host.querySelector<HTMLButtonElement>("[data-chat-withdraw-cancel]")!,
  };
}

describe("WithdrawButton", () => {
  it("arms on click and confirms withdraw on the second click", () => {
    const ui = renderWithdrawButton();

    act(() => ui.arm().click());
    act(() => ui.confirm().click());

    expect(ui.onWithdraw).toHaveBeenCalledTimes(1);
    expect(ui.confirm()).toBeNull();
  });

  it("cancel resets to the unarmed state without withdrawing", () => {
    const ui = renderWithdrawButton();

    act(() => ui.arm().click());
    act(() => ui.cancel().click());

    expect(ui.onWithdraw).not.toHaveBeenCalled();
    expect(ui.cancel()).toBeNull();
    expect(ui.arm()).not.toBeNull();
  });

  it("auto-resets after 3 seconds without interaction", () => {
    const ui = renderWithdrawButton();

    act(() => ui.arm().click());
    act(() => vi.advanceTimersByTime(3000));

    expect(ui.confirm()).toBeNull();
    expect(ui.arm()).not.toBeNull();

    act(() => ui.arm().click());
    act(() => ui.confirm().click());
    expect(ui.onWithdraw).toHaveBeenCalledTimes(1);
  });

  it("stays armed within the 3 second window", () => {
    const ui = renderWithdrawButton();

    act(() => ui.arm().click());
    act(() => vi.advanceTimersByTime(2500));
    act(() => ui.confirm().click());

    expect(ui.onWithdraw).toHaveBeenCalledTimes(1);
  });

  it("clears the reset timer on unmount", () => {
    const ui = renderWithdrawButton();

    act(() => ui.arm().click());
    act(() => root!.unmount());
    root = null;

    expect(() => act(() => vi.advanceTimersByTime(3000))).not.toThrow();
  });
});
