import { screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { AgentSummary } from "../../lib/types";
import { createMockHostBridge } from "../../test/host-bridge";
import { renderWithProviders } from "../../test/render";
import { MessageItem } from "./MessageItem";
import type { ChatMessage } from "./types";

vi.mock("../../lib/use-connection", () => ({
  useApiClient: () => ({
    getPreviewUrl: (path: string) => `http://localhost:5173/api/projects/p1/preview/${path}`,
  }),
  useConnection: () => ({ baseUrl: "http://localhost:5173", accessToken: null }),
}));

const agent = { id: "a1", name: "Helper", alias: "" } as unknown as AgentSummary;

function renderMessage(
  message: Partial<ChatMessage> & { role: "user" | "assistant" },
  props: { onWithdraw?: () => void } = {},
) {
  renderWithProviders(
    <MessageItem message={{ content: "hello", ...message } as ChatMessage} agent={agent} onWithdraw={props.onWithdraw} />,
    { bridge: createMockHostBridge() },
  );
}

describe("MessageItem withdraw action", () => {
  it("renders a withdraw action for user messages when onWithdraw is provided", async () => {
    const user = userEvent.setup();
    const onWithdraw = vi.fn();
    renderMessage({ role: "user" }, { onWithdraw });

    await user.click(screen.getByRole("button", { name: "撤回" }));
    await user.click(screen.getByRole("button", { name: "确认撤回" }));
    expect(onWithdraw).toHaveBeenCalledTimes(1);
  });

  it("omits the withdraw action for assistant messages", () => {
    renderMessage({ role: "assistant" });
    expect(screen.queryByRole("button", { name: "撤回" })).not.toBeInTheDocument();
  });

  it("omits the withdraw action while streaming", () => {
    renderMessage({ role: "user", _streaming: true } as never);
    expect(screen.queryByRole("button", { name: "撤回" })).not.toBeInTheDocument();
  });
});

describe("MessageItem user attachments", () => {
  it("renders image attachments through the preview url and zooms via a body portal", async () => {
    const user = userEvent.setup();
    renderMessage({
      role: "user",
      content: "look at this",
      _attachments: [{ type: "image", path: "uploads/pic.png", name: "pic.png" }] as never,
    });
    const thumbnail = document.querySelector<HTMLImageElement>('img[src$="uploads/pic.png"]');
    expect(thumbnail).not.toBeNull();
    expect(thumbnail!.src).toBe("http://localhost:5173/api/projects/p1/preview/uploads/pic.png");

    await user.click(thumbnail!.closest("button")!);
    const dialog = screen.getByRole("dialog");
    expect(dialog.parentElement).toBe(document.body);
    expect(dialog.querySelector('img[src$="uploads/pic.png"]')).not.toBeNull();
  });

  it("renders no attachment block when the list is empty", () => {
    renderMessage({ role: "user", _attachments: [] as never });
    expect(document.querySelector("img")).toBeNull();
  });
});

describe("MessageItem bubble links", () => {
  it("opens external links through the shared link resolver instead of navigating", async () => {
    const user = userEvent.setup();
    const openExternal = vi.fn(async () => {});
    renderWithProviders(
      <MessageItem message={{ role: "assistant", content: "[docs](https://example.com/x)" } as ChatMessage} agent={agent} />,
      { bridge: createMockHostBridge({ openExternal }) },
    );

    await user.click(screen.getByRole("link", { name: "docs" }));
    expect(openExternal).toHaveBeenCalledWith("https://example.com/x");
  });

  it("keeps in-page anchors inside the chat instead of forwarding to the browser", async () => {
    const user = userEvent.setup();
    const openExternal = vi.fn(async () => {});
    renderWithProviders(
      <MessageItem message={{ role: "assistant", content: "[jump](#section)" } as ChatMessage} agent={agent} />,
      { bridge: createMockHostBridge({ openExternal }) },
    );

    await user.click(screen.getByRole("link", { name: "jump" }));
    expect(openExternal).not.toHaveBeenCalled();
  });
});
