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
        bubbles: [{ kind: "assistant", id: "b1", entryId: "a1", text: "one" }],
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
        bubbles: [{ kind: "assistant", id: "b1", entryId: "e1", text: "answer" }],
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

  it("expands the trigger turn containing the locate target", () => {
    const triggerGroup: MessageGroup = {
      id: "g1",
      kind: "trigger-turn",
      triggerName: "daily",
      hasError: false,
      user: { kind: "user", id: "e0", seq: 0, text: "go", triggered: true },
      bubbles: [{ kind: "assistant", id: "b1", entryId: "e1", seq: 1, text: "done" }],
    };
    renderList([triggerGroup], { locateSeq: 1 });
    expect(document.querySelector('[data-entry-seq="1"]')).not.toBeNull();
    expect(document.querySelector('[data-entry-seq="0"]')).not.toBeNull();
  });

  it("keeps the trigger turn collapsed when the locate target is elsewhere", () => {
    const triggerGroup: MessageGroup = {
      id: "g1",
      kind: "trigger-turn",
      triggerName: "daily",
      hasError: false,
      user: { kind: "user", id: "e0", seq: 0, text: "go", triggered: true },
      bubbles: [{ kind: "assistant", id: "b1", entryId: "e1", seq: 1, text: "done" }],
    };
    renderList([triggerGroup], { locateSeq: 9 });
    expect(document.querySelector('[data-entry-seq="1"]')).toBeNull();
  });

  it("renders an orphan tool result bubble instead of dropping it", async () => {
    const user = userEvent.setup();
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
    expect(screen.getByText("思考过程")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /思考过程/ }));
    expect(screen.getByText("read_file")).toBeInTheDocument();
  });

  it("renders a thought bubble ahead of text bubbles and passes turn activity", () => {
    renderList([
      {
        id: "g1",
        kind: "turn",
        user: { kind: "user", id: "u1", text: "go" },
        hasError: false,
        bubbles: [
          {
            kind: "thought",
            id: "b:thought:a1",
            entryId: "a1",
            tools: [{ toolCallId: "tc1", toolName: "read_file", args: {}, status: "running" }],
          },
          { kind: "assistant", id: "b:a2", entryId: "a2", text: "partial" },
        ],
      },
    ], { streaming: true });
    expect(document.querySelector("[data-chat-thought]")).not.toBeNull();
    expect(screen.getByText("正在思考…")).toBeInTheDocument();
    const messages = [...document.querySelectorAll("[data-chat-message]")];
    expect(messages).toHaveLength(2);
    expect(messages[0]?.textContent).toContain("partial");
    expect(messages[1]?.textContent).toContain("go");
  });

  it("renders cards bubbles in entry order between text bubbles", () => {
    renderList([
      {
        id: "g1",
        kind: "turn",
        user: { kind: "user", id: "u1", text: "画两张图" },
        hasError: false,
        bubbles: [
          { kind: "thought", id: "b:thought:a1", entryId: "a1", tools: [] },
          {
            kind: "cards",
            id: "b:cards:a1",
            entryId: "a1",
            tools: [{
              toolCallId: "tc1",
              toolName: "generate_image",
              args: { prompt: "猫" },
              status: "completed",
              card: { type: "image", status: "done", path: "cat.png", prompt: "猫", mimeType: "image/png" },
            }],
          },
          { kind: "assistant", id: "b:a2", entryId: "a2", text: "中间说明" },
          {
            kind: "cards",
            id: "b:cards:a3",
            entryId: "a3",
            tools: [{
              toolCallId: "tc2",
              toolName: "generate_image",
              args: { prompt: "狗" },
              status: "completed",
              card: { type: "image", status: "done", path: "dog.png", prompt: "狗", mimeType: "image/png" },
            }],
          },
        ],
      },
    ]);
    const cards = document.querySelector("[data-chat-cards]");
    expect(cards).not.toBeNull();
    expect(screen.getByAltText("猫")).toBeInTheDocument();
    expect(screen.getByAltText("狗")).toBeInTheDocument();
    const messages = [...document.querySelectorAll("[data-chat-message]")];
    expect(messages.map((node) => node.textContent)).toEqual(
      expect.arrayContaining([expect.stringContaining("画两张图"), expect.stringContaining("中间说明")]),
    );
  });

  it("renders an orphan tool result with a card as visible cards", () => {
    renderList([
      {
        id: "g1",
        kind: "turn",
        hasError: false,
        bubbles: [{
          kind: "tool-result",
          id: "b:t1",
          entryId: "t1",
          tool: {
            toolCallId: "tc1",
            toolName: "generate_image",
            args: { prompt: "猫" },
            status: "completed",
            card: { type: "image", status: "done", path: "cat.png", prompt: "猫", mimeType: "image/png" },
          },
        }],
      },
    ]);
    expect(screen.getByAltText("猫")).toBeInTheDocument();
    expect(document.querySelector("[data-chat-cards]")).not.toBeNull();
    expect(document.querySelector("[data-chat-thought]")).toBeNull();
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
