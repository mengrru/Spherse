import { act, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "../../test/render";
import { WithdrawButton } from "./WithdrawButton";

let user: ReturnType<typeof userEvent.setup>;
let onWithdraw: ReturnType<typeof vi.fn<() => void>>;

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  user = userEvent.setup();
  onWithdraw = vi.fn();
});

afterEach(() => {
  vi.useRealTimers();
});

function renderWithdrawButton() {
  renderWithProviders(<WithdrawButton onWithdraw={onWithdraw} />);
}

describe("WithdrawButton", () => {
  it("arms on click and confirms withdraw on the second click", async () => {
    renderWithdrawButton();

    await user.click(screen.getByRole("button", { name: "撤回" }));
    await user.click(screen.getByRole("button", { name: "确认撤回" }));

    expect(onWithdraw).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: "确认撤回" })).not.toBeInTheDocument();
  });

  it("cancel resets to the unarmed state without withdrawing", async () => {
    renderWithdrawButton();

    await user.click(screen.getByRole("button", { name: "撤回" }));
    await user.click(screen.getByRole("button", { name: "取消撤回" }));

    expect(onWithdraw).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "取消撤回" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "撤回" })).toBeInTheDocument();
  });

  it("auto-resets after 3 seconds without interaction", async () => {
    renderWithdrawButton();

    await user.click(screen.getByRole("button", { name: "撤回" }));
    act(() => vi.advanceTimersByTime(3000));

    expect(screen.queryByRole("button", { name: "确认撤回" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "撤回" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "撤回" }));
    await user.click(screen.getByRole("button", { name: "确认撤回" }));
    expect(onWithdraw).toHaveBeenCalledTimes(1);
  });

  it("stays armed within the 3 second window", async () => {
    renderWithdrawButton();

    await user.click(screen.getByRole("button", { name: "撤回" }));
    act(() => vi.advanceTimersByTime(2500));
    await user.click(screen.getByRole("button", { name: "确认撤回" }));

    expect(onWithdraw).toHaveBeenCalledTimes(1);
  });

  it("clears the reset timer on unmount", async () => {
    const { unmount } = renderWithProviders(<WithdrawButton onWithdraw={onWithdraw} />);
    const before = vi.getTimerCount();

    await user.click(screen.getByRole("button", { name: "撤回" }));
    expect(vi.getTimerCount()).toBe(before + 1);

    unmount();
    expect(vi.getTimerCount()).toBe(before);
  });
});
