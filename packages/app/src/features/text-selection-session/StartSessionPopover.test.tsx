import { screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { createMockHostBridge } from "../../test/host-bridge";
import { renderWithProviders } from "../../test/render";
import { StartSessionPopover } from "./StartSessionPopover";

const dispatchAction = vi.fn();

vi.mock("../../ui-sdk", () => ({
  dispatchAction: (...args: unknown[]) => dispatchAction(...args),
}));

vi.mock("../../lib/use-connection", () => ({
  useApiClient: () => ({}),
  useConnection: () => ({ baseUrl: "http://localhost", accessToken: null }),
}));

describe("StartSessionPopover", () => {
  it("sends to the current session without re-navigating to it", async () => {
    const onClose = vi.fn();
    renderWithProviders(
      <StartSessionPopover
        selectedText="hello"
        sourcePath="a.md"
        agents={[]}
        position={{ x: 0, y: 0 }}
        projectId="p1"
        activeSessions={[{ sessionId: "s1", agentName: "Agent One", sessionTitle: "Chat", floating: false }]}
        onSubmit={vi.fn()}
        onClose={onClose}
      />,
      { bridge: createMockHostBridge(), locale: "en" },
    );

    await userEvent.click(screen.getByRole("button", { name: /Agent One/ }));
    expect(dispatchAction).toHaveBeenCalledWith(
      "sendMessage",
      expect.objectContaining({ sessionId: "s1", open: false, message: expect.stringContaining("> hello") }),
      expect.anything(),
    );
    expect(onClose).toHaveBeenCalled();
  });
});
