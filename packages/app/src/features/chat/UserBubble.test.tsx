import { screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { createMockHostBridge } from "../../test/host-bridge";
import { renderWithProviders } from "../../test/render";
import { UserBubble } from "./UserBubble";

vi.mock("../../lib/use-connection", () => ({
  useApiClient: () => ({
    getPreviewUrl: (path: string) => `http://localhost:5173/api/projects/p1/preview/${path}`,
  }),
  useConnection: () => ({ baseUrl: "http://localhost:5173", accessToken: null }),
}));

describe("UserBubble", () => {
  it("renders a withdraw action when onWithdraw is provided", async () => {
    const user = userEvent.setup();
    const onWithdraw = vi.fn();
    renderWithProviders(
      <UserBubble text="hello" onWithdraw={onWithdraw} />,
      { bridge: createMockHostBridge() },
    );

    await user.click(screen.getByRole("button", { name: "撤回" }));
    await user.click(screen.getByRole("button", { name: "确认撤回" }));
    expect(onWithdraw).toHaveBeenCalledTimes(1);
  });

  it("omits the withdraw action without a handler", () => {
    renderWithProviders(<UserBubble text="hello" />, { bridge: createMockHostBridge() });
    expect(screen.queryByRole("button", { name: "撤回" })).not.toBeInTheDocument();
  });

  it("renders image attachments through the preview url and zooms via a body portal", async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <UserBubble
        text="look at this"
        attachments={[{ type: "image", path: "uploads/pic.png", mimeType: "image/png" }]}
      />,
      { bridge: createMockHostBridge() },
    );

    const thumbnail = document.querySelector<HTMLImageElement>('img[src$="uploads/pic.png"]');
    expect(thumbnail).not.toBeNull();
    expect(thumbnail!.src).toBe("http://localhost:5173/api/projects/p1/preview/uploads/pic.png");

    await user.click(thumbnail!.closest("button")!);
    const dialog = screen.getByRole("dialog");
    expect(dialog.parentElement).toBe(document.body);
  });

  it("renders the send failed bar with a retry action", async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    renderWithProviders(
      <UserBubble text="hello" sendFailed onRetry={onRetry} />,
      { bridge: createMockHostBridge() },
    );

    await user.click(screen.getByRole("button", { name: "重试" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("renders the timestamp only when showTime is set", () => {
    const { unmount } = renderWithProviders(
      <UserBubble text="hello" timestamp={Date.now()} />,
      { bridge: createMockHostBridge() },
    );
    expect(document.querySelector("time")).toBeNull();
    unmount();

    renderWithProviders(
      <UserBubble text="hello" timestamp={Date.now()} showTime />,
      { bridge: createMockHostBridge() },
    );
    expect(document.querySelector("time")).not.toBeNull();
  });
});
