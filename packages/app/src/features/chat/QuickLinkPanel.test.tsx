import { screen } from "@testing-library/react";
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
  it("exposes the data-chat-quick-link-panel theme hook and renders the file content", () => {
    renderWithProviders(<QuickLinkPanel projectId="p1" path="notes/world.md" />, { bridge });
    expect(document.querySelector("[data-chat-quick-link-panel]")).not.toBeNull();
    expect(screen.getByText("hello")).toBeInTheDocument();
  });
});
