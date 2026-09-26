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

  it("marks persisted messages with data-entry-seq anchors", () => {
    renderList([
      {
        id: "g1",
        kind: "turn",
        user: { kind: "user", id: "e0", seq: 0, text: "question" },
        hasError: false,
        bubbles: [{ kind: "assistant", id: "b1", entryId: "e1", text: "answer", tools: [] }],
      },
      {
        id: "g2",
        kind: "turn",
        hasError: false,
        bubbles: [{ kind: "tool-result", id: "b2", entryId: "s2", tool: { toolCallId: "tc1", toolName: "read_file", args: {}, status: "completed" } }],
      },
    ]);

    const anchors = [...document.querySelectorAll("[data-entry-seq]")].map(
      (node) => node.getAttribute("data-entry-seq"),
    );
    expect(anchors).toEqual(["1", "0"]);
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

  it("passes the withdraw action only to the withdrawable user bubble", async () => {
    const user = userEvent.setup();
    const onWithdraw = vi.fn();
    renderList(
      [
        {
          id: "g1",
          kind: "turn",
          user: { kind: "user", id: "u1", text: "old" },
          hasError: false,
          bubbles: [],
        },
        {
          id: "g2",
          kind: "turn",
          user: { kind: "user", id: "u2", text: "new" },
          hasError: false,
          bubbles: [],
        },
      ],
      { withdrawableUserId: "u2", onWithdraw },
    );

    const buttons = screen.getAllByRole("button", { name: "撤回" });
    expect(buttons).toHaveLength(1);
    await user.click(buttons[0]);
    await user.click(screen.getByRole("button", { name: "确认撤回" }));
    expect(onWithdraw).toHaveBeenCalledTimes(1);
  });

  it("shows the running badge on the trigger turn identified by runningGroupId", () => {
    const triggerGroup: MessageGroup = {
      id: "g1",
      kind: "trigger-turn",
      triggerName: "daily",
      hasError: false,
      bubbles: [],
    };
    renderList([triggerGroup], { runningGroupId: "g1" });
    expect(screen.getByText("运行中")).toBeInTheDocument();
  });

  it("does not show the running badge on other trigger turns", () => {
    const triggerGroup: MessageGroup = {
      id: "g1",
      kind: "trigger-turn",
      triggerName: "daily",
      hasError: false,
      bubbles: [],
    };
    renderList([triggerGroup], { runningGroupId: "other" });
    expect(screen.queryByText("运行中")).not.toBeInTheDocument();
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
