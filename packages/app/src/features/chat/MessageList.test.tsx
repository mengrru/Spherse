import { createRef } from "react";
import { screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { AgentSummary } from "../../lib/types";
import { createMockHostBridge } from "../../test/host-bridge";
import { renderWithProviders } from "../../test/render";
import { MessageList } from "./MessageList";
import type { MessageGroup } from "./model/message-group";

vi.mock("../../lib/use-connection", () => ({
  useApiClient: () => ({
    getPreviewUrl: (path: string) => `http://localhost:5173/api/projects/p1/preview/${path}`,
  }),
  useConnection: () => ({ baseUrl: "http://localhost:5173", accessToken: null }),
}));

const agent = { id: "a1", name: "Helper", alias: "" } as unknown as AgentSummary;

function renderList(groups: MessageGroup[], extra: Record<string, unknown> = {}) {
  return renderWithProviders(
    <MessageList
      groups={groups}
      agent={agent}
      thinking={false}
      withdrawableUserId={null}
      supersededToolCallIds={new Set()}
      containerRef={createRef<HTMLDivElement>()}
      isAtBottom
      onScrollToBottom={() => {}}
      {...extra}
    />,
    { bridge: createMockHostBridge() },
  );
}

describe("MessageList", () => {
  it("renders groups newest first with user bubbles inside their turn", () => {
    renderList([
      {
        id: "g1",
        kind: "turn",
        user: { kind: "user", id: "u1", text: "first" },
        hasError: false,
        bubbles: [{ kind: "assistant", id: "b1", entryId: "a1", text: "one", tools: [] }],
      },
      {
        id: "g2",
        kind: "turn",
        user: { kind: "user", id: "u2", text: "second" },
        hasError: false,
        bubbles: [],
      },
    ]);

    const nodes = [...document.querySelectorAll("[data-chat-message]")];
    const texts = nodes.map((node) => node.textContent ?? "");
    expect(texts[0]).toContain("second");
    expect(texts[1]).toContain("one");
    expect(texts[2]).toContain("first");
  });

  it("renders an orphan tool result bubble instead of dropping it", () => {
    renderList([
      {
        id: "g1",
        kind: "turn",
        hasError: false,
        bubbles: [{
          kind: "tool-result",
          id: "b:t1",
          entryId: "t1",
          tool: { toolCallId: "tc1", toolName: "read_file", args: { path: "a.ts" }, status: "completed" },
        }],
      },
    ]);
    expect(screen.getByText("read_file")).toBeInTheDocument();
  });

  it("shows the thinking indicator when waiting for the first token", () => {
    renderList(
      [{
        id: "g1",
        kind: "turn",
        user: { kind: "user", id: "u1", text: "hi" },
        hasError: false,
        bubbles: [],
      }],
      { thinking: true },
    );
    expect(document.querySelector(".animate-bounce")).not.toBeNull();
  });

  it("loads more history through the load more button", async () => {
    const user = userEvent.setup();
    const onLoadMore = vi.fn();
    renderList(
      [{
        id: "g1",
        kind: "turn",
        user: { kind: "user", id: "u1", text: "hi" },
        hasError: false,
        bubbles: [],
      }],
      { hasMore: true, onLoadMore },
    );

    await user.click(screen.getByRole("button", { name: "加载更多" }));
    expect(onLoadMore).toHaveBeenCalledTimes(1);
  });
});
