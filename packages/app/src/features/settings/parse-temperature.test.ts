import { describe, expect, it } from "vitest";
import { parseTemperature } from "./parse-temperature";

describe("parseTemperature", () => {
  it("returns undefined for empty string", () => {
    expect(parseTemperature("")).toBeUndefined();
  });

  it("returns undefined for whitespace-only string", () => {
    expect(parseTemperature("   ")).toBeUndefined();
  });

  it("returns undefined for non-numeric input", () => {
    expect(parseTemperature("abc")).toBeUndefined();
  });

  it("returns undefined for negative values", () => {
    expect(parseTemperature("-1")).toBeUndefined();
    expect(parseTemperature("-0.5")).toBeUndefined();
  });

  it("parses a valid decimal value", () => {
    expect(parseTemperature("0.3")).toBe(0.3);
  });

  it("parses zero as 0 (a valid explicit value)", () => {
    expect(parseTemperature("0")).toBe(0);
  });

  it("trims surrounding whitespace before parsing", () => {
    expect(parseTemperature("  1.5  ")).toBe(1.5);
  });

  it("parses integer string", () => {
    expect(parseTemperature("2")).toBe(2);
  });

  it("returns undefined for mixed numeric/non-numeric input", () => {
    expect(parseTemperature("1abc")).toBeUndefined();
  });
});
