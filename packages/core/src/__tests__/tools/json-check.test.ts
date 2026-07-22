import { describe, it, expect } from "vitest";
import { checkJson } from "../../tools/json-check.js";

describe("checkJson", () => {
  it("accepts valid JSON object", () => {
    expect(checkJson('{"a":1}')).toEqual({ ok: true });
  });

  it("accepts valid JSON array", () => {
    expect(checkJson("[1, 2, 3]")).toEqual({ ok: true });
  });

  it("accepts valid JSON primitives", () => {
    expect(checkJson("42")).toEqual({ ok: true });
    expect(checkJson("true")).toEqual({ ok: true });
    expect(checkJson("null")).toEqual({ ok: true });
    expect(checkJson('"text"')).toEqual({ ok: true });
  });

  it("rejects trailing comma", () => {
    const result = checkJson('{"a":1,}');
    expect(result.ok).toBe(false);
  });

  it("rejects unquoted keys", () => {
    const result = checkJson("{a:1}");
    expect(result.ok).toBe(false);
  });

  it("rejects single quotes", () => {
    const result = checkJson("{'a':1}");
    expect(result.ok).toBe(false);
  });

  it("rejects comments", () => {
    const result = checkJson('{\n  // comment\n  "a": 1\n}');
    expect(result.ok).toBe(false);
  });

  it("returns the parser error message on failure", () => {
    const result = checkJson("{bad");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.length).toBeGreaterThan(0);
    }
  });

  it("treats empty content as valid", () => {
    expect(checkJson("")).toEqual({ ok: true });
  });

  it("treats whitespace-only content as valid", () => {
    expect(checkJson("   \n\t  ")).toEqual({ ok: true });
  });
});
