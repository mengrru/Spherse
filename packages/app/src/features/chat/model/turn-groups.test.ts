import { describe, expect, it } from "vitest";
import type { ChatMessage, RenderItem } from "../types";
import { groupTurns } from "./turn-groups";

function userMessage(overrides?: Partial<ChatMessage>): ChatMessage {
  return { role: "user", content: "q", ...overrides };
}

function assistantMessage(overrides?: Partial<ChatMessage>): ChatMessage {
  return { role: "assistant", content: "a", ...overrides };
}

const item = (message: ChatMessage, i: number): RenderItem => ({ key: `t-${i}`, message });

describe("groupTurns", () => {
  it("returns plain groups for manual messages", () => {
    const items = [item(userMessage(), 0), item(assistantMessage(), 1)];
    const groups = groupTurns(items);
    expect(groups).toEqual([
      { kind: "plain", item: { item: items[0], index: 0 } },
      { kind: "plain", item: { item: items[1], index: 1 } },
    ]);
  });

  it("wraps a trigger turn from its user message until the next user message", () => {
    const items = [
      item(userMessage(), 0),
      item(assistantMessage(), 1),
      item(userMessage({ _triggered: true, _triggerName: "daily" }), 2),
      item(assistantMessage(), 3),
      item(assistantMessage(), 4),
      item(userMessage(), 5),
      item(assistantMessage(), 6),
    ];
    const groups = groupTurns(items);
    expect(groups).toHaveLength(5);
    expect(groups[0].kind).toBe("plain");
    expect(groups[1].kind).toBe("plain");
    expect(groups[2]).toMatchObject({
      kind: "trigger",
      triggerName: "daily",
      items: [
        { index: 2 },
        { index: 3 },
        { index: 4 },
      ],
    });
    expect(groups[3].kind).toBe("plain");
    expect(groups[4].kind).toBe("plain");
  });

  it("items carry the original chronological index", () => {
    const items = [item(userMessage({ _triggered: true }), 0), item(assistantMessage(), 1)];
    const groups = groupTurns(items);
    expect(groups[0].kind).toBe("trigger");
    if (groups[0].kind !== "trigger") return;
    expect(groups[0].items.map((entry) => entry.index)).toEqual([0, 1]);
    expect(groups[0].items[0].item).toBe(items[0]);
  });

  it("flags hasError when any message in the trigger turn carries an error", () => {
    const items = [
      item(userMessage({ _triggered: true, _triggerName: "t" }), 0),
      item(assistantMessage({ _turnError: true, _error: "boom" }), 1),
    ];
    const groups = groupTurns(items);
    expect(groups[0]).toMatchObject({ kind: "trigger", hasError: true });
  });

  it("keeps hasError false for a successful trigger turn", () => {
    const items = [
      item(userMessage({ _triggered: true, _triggerName: "t" }), 0),
      item(assistantMessage(), 1),
    ];
    const groups = groupTurns(items);
    expect(groups[0]).toMatchObject({ kind: "trigger", hasError: false });
  });

  it("omits triggerName when the user message has none", () => {
    const items = [item(userMessage({ _triggered: true }), 0), item(assistantMessage(), 1)];
    const groups = groupTurns(items);
    expect(groups[0]).toMatchObject({ kind: "trigger" });
    expect((groups[0] as { triggerName?: string }).triggerName).toBeUndefined();
  });

  it("handles an open trigger turn at the end without assistant messages", () => {
    const items = [
      item(userMessage(), 0),
      item(assistantMessage(), 1),
      item(userMessage({ _triggered: true }), 2),
    ];
    const groups = groupTurns(items);
    expect(groups).toHaveLength(3);
    expect(groups[2]).toMatchObject({ kind: "trigger", items: [{ index: 2 }] });
  });

  it("keeps leading assistant messages plain before the first user message", () => {
    const items = [
      item(assistantMessage(), 0),
      item(userMessage({ _triggered: true }), 1),
      item(assistantMessage(), 2),
    ];
    const groups = groupTurns(items);
    expect(groups[0].kind).toBe("plain");
    expect(groups[1].kind).toBe("trigger");
  });

  it("returns an empty array for empty messages", () => {
    expect(groupTurns([])).toEqual([]);
  });
});
