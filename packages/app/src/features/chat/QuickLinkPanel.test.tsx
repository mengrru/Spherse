import { screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "../../test/render";
import { createMockHostBridge } from "../../test/host-bridge";
import { QuickLinkPanel, resolveQuickLinkAction } from "./QuickLinkPanel";

vi.mock("../content-browser/hooks/useContentFile", () => ({
  useContentFile: () => ({
    content: "# hello",
    binary: false,
    loading: false,
    error: null,
    dataUpdatedAt: 1,
  }),
}));

const bridge = createMockHostBridge();

function renderPanel(props: { path?: string; onClose?: () => void } = {}) {
  const { path = "notes/world.md", onClose = vi.fn() } = props;
  return renderWithProviders(
    <QuickLinkPanel projectId="p1" path={path} onClose={onClose} />,
    { bridge },
  );
}

describe("resolveQuickLinkAction", () => {
  it("opens the slide-out panel on mobile", () => {
    expect(resolveQuickLinkAction(true, true)).toBe("panel");
    expect(resolveQuickLinkAction(true, false)).toBe("panel");
  });

  it("opens a floating window on desktop when floats are available", () => {
    expect(resolveQuickLinkAction(false, true)).toBe("float");
  });

  it("falls back to page navigation on desktop hosts without floats", () => {
    expect(resolveQuickLinkAction(false, false)).toBe("navigate");
  });
});

describe("QuickLinkPanel", () => {
  it("exposes the data-chat-quick-link-panel theme hook and the file name", () => {
    renderPanel();
    expect(document.querySelector("[data-chat-quick-link-panel]")).not.toBeNull();
    expect(screen.getByText("world.md")).toBeInTheDocument();
  });

  it("invokes onClose when the close button is clicked", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    renderPanel({ onClose });

    await user.click(screen.getByRole("button", { name: "关闭" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
