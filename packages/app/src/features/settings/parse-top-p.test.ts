import { describe, expect, it } from "vitest";
import { parseTopP } from "./parse-top-p";

describe("parseTopP", () => {
  it("returns undefined for empty string", () => {
    expect(parseTopP("")).toBeUndefined();
  });

  it("returns undefined for whitespace-only string", () => {
    expect(parseTopP("   ")).toBeUndefined();
  });

  it("returns undefined for non-numeric input", () => {
    expect(parseTopP("abc")).toBeUndefined();
  });

  it("returns undefined for negative values", () => {
    expect(parseTopP("-1")).toBeUndefined();
    expect(parseTopP("-0.1")).toBeUndefined();
  });

  it("returns undefined for values greater than 1", () => {
    expect(parseTopP("1.1")).toBeUndefined();
    expect(parseTopP("2")).toBeUndefined();
  });

  it("parses a valid decimal value within 0–1", () => {
    expect(parseTopP("0.3")).toBe(0.3);
    expect(parseTopP("0.9")).toBe(0.9);
  });

  it("parses zero as 0 (a valid explicit value)", () => {
    expect(parseTopP("0")).toBe(0);
  });

  it("parses 1 as 1 (the upper bound)", () => {
    expect(parseTopP("1")).toBe(1);
  });

  it("trims surrounding whitespace before parsing", () => {
    expect(parseTopP("  0.5  ")).toBe(0.5);
  });

  it("returns undefined for mixed numeric/non-numeric input", () => {
    expect(parseTopP("0.5abc")).toBeUndefined();
  });
});
