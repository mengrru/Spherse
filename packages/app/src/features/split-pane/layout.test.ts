import { describe, expect, it } from "vitest";
import {
  SPLIT_DEFAULT_RATIO,
  SPLIT_MIN_MAIN_WIDTH,
  SPLIT_MIN_PANE_WIDTH,
  clampRatio,
  isValidRatio,
} from "./layout";

describe("split-pane layout", () => {
  it("validates ratios strictly between 0 and 1", () => {
    expect(isValidRatio(0.5)).toBe(true);
    expect(isValidRatio(0)).toBe(false);
    expect(isValidRatio(1)).toBe(false);
    expect(isValidRatio(Number.NaN)).toBe(false);
    expect(isValidRatio("0.5")).toBe(false);
  });

  it("keeps ratios that satisfy both minimum widths", () => {
    expect(clampRatio(0.5, 1200)).toBe(0.5);
  });

  it("clamps the pane to its minimum width", () => {
    expect(clampRatio(0.05, 1200)).toBeCloseTo(SPLIT_MIN_PANE_WIDTH / 1200);
  });

  it("clamps the main column to its minimum width", () => {
    expect(clampRatio(0.95, 1200)).toBeCloseTo(1 - SPLIT_MIN_MAIN_WIDTH / 1200);
  });

  it("falls back to the default ratio when the container is too narrow", () => {
    expect(clampRatio(0.3, SPLIT_MIN_MAIN_WIDTH + SPLIT_MIN_PANE_WIDTH - 1)).toBe(SPLIT_DEFAULT_RATIO);
  });

  it("returns a valid ratio when the container width is unknown", () => {
    expect(clampRatio(0.3, 0)).toBe(0.3);
    expect(clampRatio(2, 0)).toBe(SPLIT_DEFAULT_RATIO);
  });
});
