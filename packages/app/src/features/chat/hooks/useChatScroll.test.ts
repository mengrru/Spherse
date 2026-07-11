import { describe, expect, it } from "vitest";
import { isNearBottom } from "./useChatScroll";

describe("isNearBottom (column-reverse: scrollTop 0 = bottom, negative = scrolled up)", () => {
  it("treats scrollTop 0 as pinned to the bottom", () => {
    expect(isNearBottom(0)).toBe(true);
  });

  it("returns true within the default 100px threshold (scrollTop between -100 and 0)", () => {
    expect(isNearBottom(-50)).toBe(true);
    expect(isNearBottom(-100)).toBe(true);
  });

  it("returns false once scrolled up past the threshold (scrollTop < -100)", () => {
    expect(isNearBottom(-101)).toBe(false);
    expect(isNearBottom(-800)).toBe(false);
  });

  it("honours a custom threshold", () => {
    expect(isNearBottom(-40, 40)).toBe(true);
    expect(isNearBottom(-41, 40)).toBe(false);
  });
});
