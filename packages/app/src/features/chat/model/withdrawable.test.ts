import { describe, expect, it } from "vitest";
import type { ChatMessage, RenderItem } from "../types";
import { lastWithdrawableUserIndex } from "./withdrawable";

const item = (message: ChatMessage, i: number): RenderItem => ({ key: `t-${i}`, message });

describe("lastWithdrawableUserIndex", () => {
  it("returns the index of the last user message", () => {
    const items = [
      item({ role: "user", content: "q1" }, 0),
      item({ role: "assistant", content: "a1" }, 1),
      item({ role: "user", content: "q2" }, 2),
    ];
    expect(lastWithdrawableUserIndex(items)).toBe(2);
  });

  it("returns -1 when there is no user message", () => {
    expect(lastWithdrawableUserIndex([item({ role: "assistant", content: "a1" }, 0)])).toBe(-1);
    expect(lastWithdrawableUserIndex([])).toBe(-1);
  });

  it("returns -1 when the last user message failed to send", () => {
    const items: RenderItem[] = [
      item({ role: "user", content: "q1" }, 0),
      item({ role: "assistant", content: "a1" }, 1),
      { key: "t-2", message: { role: "user", content: "q2" }, sendFailed: true },
    ];
    expect(lastWithdrawableUserIndex(items)).toBe(-1);
  });

  it("ignores earlier send-failed user messages", () => {
    const items: RenderItem[] = [
      { key: "t-0", message: { role: "user", content: "q1" }, sendFailed: true },
      item({ role: "user", content: "q2" }, 1),
      item({ role: "assistant", content: "a2" }, 2),
    ];
    expect(lastWithdrawableUserIndex(items)).toBe(1);
  });
});
