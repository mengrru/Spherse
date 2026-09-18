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

  it("renders quick link buttons with basename labels and theme hook", () => {
    renderWithProviders(
      <Header
        agent={agent}
        quickLinks={["notes/world.md", "chars/hero.md"]}
        onQuickLink={vi.fn()}
      />,
    );
    expect(document.querySelector("[data-chat-quick-links]")).not.toBeNull();
    expect(screen.getByRole("button", { name: "world.md" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "hero.md" })).toBeInTheDocument();
  });

  it("calls onQuickLink with the full path on click", async () => {
    const user = userEvent.setup();
    const onQuickLink = vi.fn();
    renderWithProviders(
      <Header agent={agent} quickLinks={["notes/world.md"]} onQuickLink={onQuickLink} />,
    );

    await user.click(screen.getByRole("button", { name: "world.md" }));
    expect(onQuickLink).toHaveBeenCalledWith("notes/world.md");
  });

  it("marks the active quick link button", () => {
    renderWithProviders(
      <Header
        agent={agent}
        quickLinks={["notes/world.md", "chars/hero.md"]}
        activeQuickLink="notes/world.md"
        onQuickLink={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: "world.md" }).className).toContain("bg-secondary");
    expect(screen.getByRole("button", { name: "hero.md" }).className).not.toContain("bg-secondary");
  });

  it("renders no quick links container when the list is empty", () => {
    renderWithProviders(<Header agent={agent} quickLinks={[]} />);
    expect(document.querySelector("[data-chat-quick-links]")).toBeNull();
  });

  it("deduplicates repeated quick link paths", () => {
    renderWithProviders(
      <Header agent={agent} quickLinks={["notes/world.md", "notes/world.md"]} />,
    );
    expect(screen.getAllByRole("button", { name: "world.md" })).toHaveLength(1);
  });

  it("falls back to the full path when the basename is empty", () => {
    renderWithProviders(<Header agent={agent} quickLinks={["notes/"]} />);
    expect(screen.getByTitle("notes/")).toBeInTheDocument();
  });
});
