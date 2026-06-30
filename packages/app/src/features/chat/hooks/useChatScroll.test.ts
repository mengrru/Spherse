import { describe, expect, it } from "vitest";
import { shouldStickToBottom } from "./useChatScroll";

describe("shouldStickToBottom", () => {
  it("returns true when exactly at the bottom", () => {
    expect(shouldStickToBottom(1000, 0, 1000)).toBe(true);
    expect(shouldStickToBottom(2000, 1000, 1000)).toBe(true);
  });

  it("returns true within the one-third-viewport threshold (inclusive)", () => {
    expect(shouldStickToBottom(1333, 0, 1000)).toBe(true);
    expect(shouldStickToBottom(2000, 667, 1000)).toBe(true);
  });

  it("returns false once scrolled up more than one-third of the viewport", () => {
    expect(shouldStickToBottom(1334, 0, 1000)).toBe(false);
    expect(shouldStickToBottom(3000, 0, 1000)).toBe(false);
    expect(shouldStickToBottom(5000, 1000, 1000)).toBe(false);
  });

  it("scales with viewport height", () => {
    expect(shouldStickToBottom(1066, 0, 800)).toBe(true);
    expect(shouldStickToBottom(1067, 0, 800)).toBe(false);
  });

  it("guards against non-positive client height", () => {
    expect(shouldStickToBottom(1000, 0, 0)).toBe(true);
    expect(shouldStickToBottom(1000, 0, -5)).toBe(true);
  });
});
