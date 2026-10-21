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
    <AssistantBubble agent={agent} text="hello" {...props} />,
    { bridge: createMockHostBridge() },
  );
}

describe("AssistantBubble", () => {
  it("opens external links through the shared link resolver instead of navigating", async () => {
    const user = userEvent.setup();
    const openExternal = vi.fn(async () => {});
    renderWithProviders(
      <AssistantBubble agent={agent} text="[docs](https://example.com/x)" />,
      { bridge: createMockHostBridge({ openExternal }) },
    );

    await user.click(screen.getByRole("link", { name: "docs" }));
    expect(openExternal).toHaveBeenCalledWith("https://example.com/x");
  });

  it("keeps in-page anchors inside the chat instead of forwarding to the browser", async () => {
    const user = userEvent.setup();
    const openExternal = vi.fn(async () => {});
    renderWithProviders(
      <AssistantBubble agent={agent} text="[jump](#section)" />,
      { bridge: createMockHostBridge({ openExternal }) },
    );

    await user.click(screen.getByRole("link", { name: "jump" }));
    expect(openExternal).not.toHaveBeenCalled();
  });

  it("hides the footer while streaming", () => {
    renderBubble({ streaming: true });
    expect(screen.queryByTitle("复制")).not.toBeInTheDocument();
  });

  it("renders single-tilde text literally in both streaming and loaded messages", () => {
    const streaming = renderBubble({ text: "内容A~内容B，内容C~内容D", streaming: true });
    expect(streaming.container.querySelector("del")).toBeNull();
    expect(streaming.container.textContent).toContain("内容A~内容B，内容C~内容D");
    streaming.unmount();

    const loaded = renderBubble({ text: "内容A~内容B，内容C~内容D" });
    expect(loaded.container.querySelector("del")).toBeNull();
    expect(loaded.container.textContent).toContain("内容A~内容B，内容C~内容D");
  });

  it("still renders double-tilde strikethrough in assistant messages", () => {
    const { container } = renderBubble({ text: "~~删除线~~" });
    expect(container.querySelector("del")?.textContent).toBe("删除线");
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
