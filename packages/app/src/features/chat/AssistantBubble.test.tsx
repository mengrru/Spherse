import { screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { AgentSummary } from "../../lib/types";
import { createMockHostBridge } from "../../test/host-bridge";
import { renderWithProviders } from "../../test/render";
import { AssistantBubble } from "./AssistantBubble";

vi.mock("../../lib/use-connection", () => ({
  useApiClient: () => ({
    getPreviewUrl: (path: string) => `http://localhost:5173/api/projects/p1/preview/${path}`,
  }),
  useConnection: () => ({ baseUrl: "http://localhost:5173", accessToken: null }),
}));

const agent = { id: "a1", name: "Helper", alias: "" } as unknown as AgentSummary;

function renderBubble(props: Partial<Parameters<typeof AssistantBubble>[0]> = {}) {
  return renderWithProviders(
    <AssistantBubble agent={agent} text="hello" tools={[]} {...props} />,
    { bridge: createMockHostBridge() },
  );
}

describe("AssistantBubble", () => {
  it("opens external links through the shared link resolver instead of navigating", async () => {
    const user = userEvent.setup();
    const openExternal = vi.fn(async () => {});
    renderWithProviders(
      <AssistantBubble agent={agent} text="[docs](https://example.com/x)" tools={[]} />,
      { bridge: createMockHostBridge({ openExternal }) },
    );

    await user.click(screen.getByRole("link", { name: "docs" }));
    expect(openExternal).toHaveBeenCalledWith("https://example.com/x");
  });

  it("keeps in-page anchors inside the chat instead of forwarding to the browser", async () => {
    const user = userEvent.setup();
    const openExternal = vi.fn(async () => {});
    renderWithProviders(
      <AssistantBubble agent={agent} text="[jump](#section)" tools={[]} />,
      { bridge: createMockHostBridge({ openExternal }) },
    );

    await user.click(screen.getByRole("link", { name: "jump" }));
    expect(openExternal).not.toHaveBeenCalled();
  });

  it("shows the thinking indicator and hides the footer while streaming", () => {
    renderBubble({ text: "", streaming: true });
    expect(document.querySelector(".animate-bounce")).not.toBeNull();
    expect(screen.queryByTitle("复制")).not.toBeInTheDocument();
  });

  it("renders tool rows", () => {
    renderBubble({
      tools: [{ toolCallId: "tc1", toolName: "read_file", args: { path: "a.ts" }, status: "completed" }],
    });
    expect(screen.getByText("read_file")).toBeInTheDocument();
    expect(screen.getByText("→ a.ts")).toBeInTheDocument();
  });

  it("offers a retry action for errors and hides it when retry is suppressed", async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    const { unmount } = renderBubble({
      text: "",
      error: { message: "boom" },
      onRetry,
    });
    await user.click(screen.getByRole("button", { name: "重试" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
    unmount();

    renderBubble({
      text: "",
      error: { message: "boom", retrySuppressed: true },
      onRetry,
    });
    expect(screen.queryByRole("button", { name: "重试" })).not.toBeInTheDocument();
  });
});
