import { describe, expect, it } from "vitest";
import { mergeHistoryMessages, parseHistoryMessages } from "./chat-history";

describe("parseHistoryMessages trigger metadata", () => {
  it("maps source/triggerName onto user view fields", () => {
    const result = parseHistoryMessages([
      { id: 1, message: { role: "user", content: "report", timestamp: 1 }, source: "triggered", triggerName: "每日汇报" },
      { id: 2, message: { role: "assistant", content: [{ type: "text", text: "done" }], timestamp: 2 } },
      { id: 3, message: { role: "user", content: "manual", timestamp: 3 } },
    ]);

    expect(result[0]).toMatchObject({
      _messageId: 1,
      role: "user",
      content: "report",
      _triggered: true,
      _triggerName: "每日汇报",
    });
    expect(result[2]).toMatchObject({ _messageId: 3, role: "user", content: "manual" });
    expect(result[2]._triggered).toBeUndefined();
    expect(result[2]._triggerName).toBeUndefined();
  });

  it("sets _triggered even when triggerName is missing", () => {
    const result = parseHistoryMessages([
      { id: 1, message: { role: "user", content: "x", timestamp: 1 }, source: "triggered" },
    ]);
    expect(result[0]._triggered).toBe(true);
    expect(result[0]._triggerName).toBeUndefined();
  });

  it("keeps plain arrays of messages working", () => {
    const result = parseHistoryMessages([{ role: "user", content: "x" }]);
    expect(result[0]).toMatchObject({ role: "user", content: "x" });
    expect(result[0]._triggered).toBeUndefined();
  });
});

describe("mergeHistoryMessages trigger metadata", () => {
  it("preserves trigger fields when merging persisted messages across pages", () => {
    const older = parseHistoryMessages([
      { id: 1, message: { role: "user", content: "report", timestamp: 1 }, source: "triggered", triggerName: "t" },
      { id: 2, message: { role: "assistant", content: [{ type: "text", text: "done" }], timestamp: 2 } },
    ]);
    const newer = parseHistoryMessages([
      { id: 3, message: { role: "user", content: "hi", timestamp: 3 } },
    ]);

    const merged = mergeHistoryMessages([...older, ...newer], older);
    const triggerUser = merged.find((message) => message._messageId === 1);
    expect(triggerUser).toMatchObject({ _triggered: true, _triggerName: "t" });
    expect(merged).toHaveLength(3);
  });
});
