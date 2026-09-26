import { screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { renderWithProviders } from "../../test/render";
import { TriggerTurnGroup } from "./TriggerTurnGroup";
import type { MessageGroup } from "./model/message-group";

function group(overrides: Partial<MessageGroup> = {}): MessageGroup {
  return {
    id: "g1",
    kind: "trigger-turn",
    hasError: false,
    bubbles: [
      { kind: "assistant", id: "b1", entryId: "a1", text: "one", tools: [] },
      { kind: "assistant", id: "b2", entryId: "a2", text: "two", tools: [] },
    ],
    ...overrides,
  };
}

function renderGroup(
  props: {
    triggerName?: string;
    hasError?: boolean;
    running?: boolean;
    forceOpen?: boolean;
  } = {},
) {
  const view = renderWithProviders(
    <TriggerTurnGroup
      group={group({
        ...(props.triggerName !== undefined ? { triggerName: props.triggerName } : {}),
        hasError: props.hasError ?? false,
      })}
      running={props.running ?? false}
      forceOpen={props.forceOpen ?? false}
      renderUser={() => null}
      renderBubble={(_bubble, index) => <div>rendered-{index}</div>}
    />,
  );
  return {
    ...view,
    rerenderWith: (next: { forceOpen?: boolean }) =>
      view.rerender(
        <TriggerTurnGroup
          group={group({ triggerName: "daily" })}
          running={false}
          forceOpen={next.forceOpen ?? false}
          renderUser={() => null}
          renderBubble={(_bubble, index) => <div>rendered-{index}</div>}
        />,
      ),
  };
}

describe("TriggerTurnGroup", () => {
  it("defaults to collapsed and only renders items after expanding", async () => {
    const user = userEvent.setup();
    renderGroup({ triggerName: "daily" });

    expect(screen.queryByText("rendered-0")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /触发器「daily」触发的对话轮/ }));
    expect(screen.getByText("rendered-0")).toBeInTheDocument();
    expect(screen.getByText("rendered-1")).toBeInTheDocument();
  });

  it("uses the generic summary when the trigger name is unknown", () => {
    renderGroup();
    expect(screen.getByRole("button", { name: "触发器触发的对话轮" })).toBeInTheDocument();
  });

  it("shows the error badge only when the turn failed", () => {
    renderGroup({ hasError: false });
    expect(screen.queryByText("运行失败")).not.toBeInTheDocument();

    renderGroup({ hasError: true });
    expect(screen.getByText("运行失败")).toBeInTheDocument();
  });

  it("shows the running badge only while the turn is executing", () => {
    renderGroup({ running: false });
    expect(screen.queryByText("运行中")).not.toBeInTheDocument();

    renderGroup({ running: true });
    expect(screen.getByText("运行中")).toBeInTheDocument();
  });

  it("exposes the data-chat-turn-collapse theme hook on the summary bar", () => {
    renderGroup();
    expect(document.querySelector("[data-chat-turn-collapse]")).not.toBeNull();
  });

  it("renders items immediately when forceOpen is set", () => {
    renderGroup({ triggerName: "daily", forceOpen: true });
    expect(screen.getByText("rendered-0")).toBeInTheDocument();
    expect(screen.getByText("rendered-1")).toBeInTheDocument();
  });

  it("stays expanded after forceOpen is withdrawn", async () => {
    const user = userEvent.setup();
    const { rerenderWith } = renderGroup({ triggerName: "daily", forceOpen: true });
    expect(screen.getByText("rendered-0")).toBeInTheDocument();

    rerenderWith({ forceOpen: false });
    expect(screen.getByText("rendered-0")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /触发器「daily」触发的对话轮/ }));
    expect(screen.queryByText("rendered-0")).not.toBeInTheDocument();
  });
});
