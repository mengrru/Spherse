import { describe, expect, it } from "vitest";
import type { ChatMessage } from "../types";
import { lastWithdrawableUserIndex } from "./withdrawable";

describe("lastWithdrawableUserIndex", () => {
  it("returns the index of the last user message", () => {
    const messages: ChatMessage[] = [
      { role: "user", content: "q1" },
      { role: "assistant", content: "a1" },
      { role: "user", content: "q2" },
    ];
    expect(lastWithdrawableUserIndex(messages)).toBe(2);
  });

  it("returns -1 when there is no user message", () => {
    expect(lastWithdrawableUserIndex([{ role: "assistant", content: "a1" }])).toBe(-1);
    expect(lastWithdrawableUserIndex([])).toBe(-1);
  });

  it("returns -1 when the last user message failed to send", () => {
    const messages: ChatMessage[] = [
      { role: "user", content: "q1" },
      { role: "assistant", content: "a1" },
      { role: "user", content: "q2", _sendFailed: true },
    ];
    expect(lastWithdrawableUserIndex(messages)).toBe(-1);
  });

  it("ignores earlier send-failed user messages", () => {
    const messages: ChatMessage[] = [
      { role: "user", content: "q1", _sendFailed: true },
      { role: "user", content: "q2" },
      { role: "assistant", content: "a2" },
    ];
    expect(lastWithdrawableUserIndex(messages)).toBe(1);
  });
});
