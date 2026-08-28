import { describe, expect, it } from "vitest";
import type { ChatMessage } from "../types";
import { groupTurns } from "./turn-groups";

function userMessage(overrides?: Partial<ChatMessage>): ChatMessage {
  return { role: "user", content: "q", ...overrides };
}

function assistantMessage(overrides?: Partial<ChatMessage>): ChatMessage {
  return { role: "assistant", content: "a", ...overrides };
}

describe("groupTurns", () => {
  it("returns plain groups for manual messages", () => {
    const messages = [userMessage(), assistantMessage()];
    const groups = groupTurns(messages);
    expect(groups).toEqual([
      { kind: "plain", item: { message: messages[0], index: 0 } },
      { kind: "plain", item: { message: messages[1], index: 1 } },
    ]);
  });

  it("wraps a trigger turn from its user message until the next user message", () => {
    const messages = [
      userMessage(),
      assistantMessage(),
      userMessage({ _triggered: true, _triggerName: "daily" }),
      assistantMessage(),
      assistantMessage(),
      userMessage(),
      assistantMessage(),
    ];
    const groups = groupTurns(messages);
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
    const messages = [
      userMessage({ _triggered: true }),
      assistantMessage(),
    ];
    const groups = groupTurns(messages);
    expect(groups[0].kind).toBe("trigger");
    if (groups[0].kind !== "trigger") return;
    expect(groups[0].items.map((item) => item.index)).toEqual([0, 1]);
    expect(groups[0].items[0].message).toBe(messages[0]);
  });

  it("flags hasError when any message in the trigger turn carries an error", () => {
    const messages = [
      userMessage({ _triggered: true, _triggerName: "t" }),
      assistantMessage({ _turnError: true, _error: "boom" }),
    ];
    const groups = groupTurns(messages);
    expect(groups[0]).toMatchObject({ kind: "trigger", hasError: true });
  });

  it("keeps hasError false for a successful trigger turn", () => {
    const messages = [
      userMessage({ _triggered: true, _triggerName: "t" }),
      assistantMessage(),
    ];
    const groups = groupTurns(messages);
    expect(groups[0]).toMatchObject({ kind: "trigger", hasError: false });
  });

  it("omits triggerName when the user message has none", () => {
    const messages = [userMessage({ _triggered: true }), assistantMessage()];
    const groups = groupTurns(messages);
    expect(groups[0]).toMatchObject({ kind: "trigger" });
    expect((groups[0] as { triggerName?: string }).triggerName).toBeUndefined();
  });

  it("handles an open trigger turn at the end without assistant messages", () => {
    const messages = [userMessage(), assistantMessage(), userMessage({ _triggered: true })];
    const groups = groupTurns(messages);
    expect(groups).toHaveLength(3);
    expect(groups[2]).toMatchObject({ kind: "trigger", items: [{ index: 2 }] });
  });

  it("keeps leading assistant messages plain before the first user message", () => {
    const messages = [
      assistantMessage(),
      userMessage({ _triggered: true }),
      assistantMessage(),
    ];
    const groups = groupTurns(messages);
    expect(groups[0].kind).toBe("plain");
    expect(groups[1].kind).toBe("trigger");
  });

  it("returns an empty array for empty messages", () => {
    expect(groupTurns([])).toEqual([]);
  });
});
