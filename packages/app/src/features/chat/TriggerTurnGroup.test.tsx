import { screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { renderWithProviders } from "../../test/render";
import { TriggerTurnGroup } from "./TriggerTurnGroup";
import type { TurnGroupItem } from "./model/turn-groups";

const items = [{ kind: "message" }, { kind: "message" }] as unknown as TurnGroupItem[];

function renderGroup(props: { triggerName?: string; hasError?: boolean } = {}) {
  renderWithProviders(
    <TriggerTurnGroup
      items={items}
      triggerName={props.triggerName}
      hasError={props.hasError ?? false}
      renderItem={(item) => <div key={String(item)}>rendered-{items.indexOf(item)}</div>}
    />,
  );
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

  it("exposes the data-chat-turn-collapse theme hook on the summary bar", () => {
    renderGroup();
    expect(document.querySelector("[data-chat-turn-collapse]")).not.toBeNull();
  });
});
