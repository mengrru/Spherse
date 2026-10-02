import { describe, expect, it } from "vitest";
import { beginQuit, beginUpdateQuit, isQuitting, isUpdateQuit } from "./lifecycle.js";

describe("lifecycle quit flag", () => {
  it("only the first beginQuit wins and isQuitting reflects it", () => {
    expect(isQuitting()).toBe(false);
    expect(beginQuit()).toBe(true);
    expect(isQuitting()).toBe(true);
    expect(beginQuit()).toBe(false);
    expect(isQuitting()).toBe(true);
  });
});

describe("lifecycle update-quit flag", () => {
  it("only the first beginUpdateQuit wins and it also marks the app as quitting", () => {
    expect(isUpdateQuit()).toBe(false);
    expect(beginUpdateQuit()).toBe(true);
    expect(isUpdateQuit()).toBe(true);
    expect(isQuitting()).toBe(true);
    expect(beginUpdateQuit()).toBe(false);
    expect(beginQuit()).toBe(false);
  });
});
