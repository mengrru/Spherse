import { act, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Route, Routes, useNavigate } from "react-router";
import { renderWithProviders } from "../../test/render";
import { useSidePanelStore } from "../../stores/side-panel-store";
import { SidePanel } from "./index";

vi.mock("../../hooks/use-mobile", () => ({
  useIsMobile: vi.fn(),
}));

vi.mock("../activity-bar", () => ({
  ActivityBar: () => <nav data-testid="activity-bar" />,
}));
vi.mock("../project-panel", () => ({
  ProjectPanel: () => <aside data-testid="project-panel" />,
}));

import { useIsMobile } from "../../hooks/use-mobile";

function mobileDrawer(): HTMLElement {
  const drawer = document.querySelector("div.fixed.inset-y-0") as HTMLElement | null;
  if (!drawer) throw new Error("mobile drawer not found");
  return drawer;
}

function desktopPanel(): HTMLElement {
  const panel = document.querySelector("[data-side-panel]") as HTMLElement | null;
  if (!panel) throw new Error("desktop panel not found");
  return panel;
}

function setMobile(mobile: boolean) {
  vi.mocked(useIsMobile).mockReturnValue(mobile);
}

beforeEach(() => {
  useSidePanelStore.setState({ pinned: false, hovered: false, mobileOpen: false });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("SidePanel mobile branch", () => {
  it("renders a start-edge tab button that opens the drawer with dialog semantics", async () => {
    setMobile(true);
    const user = userEvent.setup();
    renderWithProviders(<SidePanel />);

    const tab = screen.getByRole("button", { name: "打开项目面板" });
    expect(tab).toHaveAttribute("aria-haspopup", "dialog");
    expect(tab).toHaveAttribute("aria-expanded", "false");

    await user.click(tab);
    expect(tab).toHaveAttribute("aria-expanded", "true");
    expect(useSidePanelStore.getState().mobileOpen).toBe(true);
    expect(screen.getByTestId("activity-bar")).toBeInTheDocument();
  });

  it("keeps the closed drawer off the a11y tree via inert", () => {
    setMobile(true);
    renderWithProviders(<SidePanel />);

    expect(mobileDrawer().hasAttribute("inert")).toBe(true);

    act(() => {
      useSidePanelStore.setState({ mobileOpen: true });
    });
    expect(mobileDrawer().hasAttribute("inert")).toBe(false);
  });

  it("closes the drawer after navigating from within it", async () => {
    setMobile(true);
    const user = userEvent.setup();
    function NavButton() {
      const navigate = useNavigate();
      return (
        <button type="button" onClick={() => navigate("/project/p1/chat")}>
          go chat
        </button>
      );
    }
    renderWithProviders(
      <>
        <SidePanel />
        <Routes>
          <Route path="/" element={<div data-testid="home-page" />} />
          <Route path="/project/:projectId/chat" element={<div data-testid="chat-page" />} />
        </Routes>
        <NavButton />
      </>,
      { route: "/" },
    );

    await user.click(screen.getByRole("button", { name: "打开项目面板" }));
    expect(useSidePanelStore.getState().mobileOpen).toBe(true);

    await user.click(screen.getByRole("button", { name: "go chat" }));
    expect(await screen.findByTestId("chat-page")).toBeInTheDocument();
    expect(useSidePanelStore.getState().mobileOpen).toBe(false);
  });
});

describe("SidePanel desktop branch", () => {
  it("keeps the hidden panel inert and reveals it on hover", async () => {
    setMobile(false);
    const user = userEvent.setup();
    renderWithProviders(<SidePanel />);

    expect(desktopPanel().hasAttribute("inert")).toBe(true);

    await user.hover(desktopPanel());
    expect(useSidePanelStore.getState().hovered).toBe(true);
    expect(desktopPanel().hasAttribute("inert")).toBe(false);

    await user.unhover(desktopPanel());
    await waitFor(() => expect(useSidePanelStore.getState().hovered).toBe(false));
    expect(desktopPanel().hasAttribute("inert")).toBe(true);
  });

  it("renders the pinned panel without inert and without the hover reveal strip", () => {
    setMobile(false);
    useSidePanelStore.setState({ pinned: true });
    renderWithProviders(<SidePanel />);

    expect(desktopPanel().hasAttribute("inert")).toBe(false);
    expect(screen.queryByTestId("activity-bar")).toBeInTheDocument();
  });
});
