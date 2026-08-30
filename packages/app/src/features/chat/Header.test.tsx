import { screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { AgentSummary } from "../../lib/types";
import { renderWithProviders } from "../../test/render";
import { Header } from "./Header";

const agent = { id: "a1", name: "Writer" } as unknown as AgentSummary;

describe("Chat Header", () => {
  it("exposes the data-chat-header theme hook and the agent name", () => {
    renderWithProviders(<Header agent={agent} />);
    const header = document.querySelector("[data-chat-header]");
    expect(header).not.toBeNull();
    expect(screen.getByText("Writer")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "关闭" })).not.toBeInTheDocument();
  });

  it("renders the close button when onClose is provided", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    renderWithProviders(<Header agent={agent} onClose={onClose} />);

    await user.click(screen.getByRole("button", { name: "关闭" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
