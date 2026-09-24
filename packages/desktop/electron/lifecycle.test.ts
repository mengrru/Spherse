import { describe, expect, it } from "vitest";
import { beginQuit, isQuitting } from "./lifecycle.js";

describe("lifecycle quit flag", () => {
  it("only the first beginQuit wins and isQuitting reflects it", () => {
    expect(isQuitting()).toBe(false);
    expect(beginQuit()).toBe(true);
    expect(isQuitting()).toBe(true);
    expect(beginQuit()).toBe(false);
    expect(isQuitting()).toBe(true);
  });
});
